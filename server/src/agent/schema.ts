// Schema retrieval over the Zetaris catalog. Primary: BM25 over table name + description + column
// names/descriptions (works with any provider; the Meterless runtime contract documents no embeddings endpoint).
// If the LLM provider proves it can embed (llm.canEmbed() probe), cosine similarity is blended in; embeddings are
// cached per model+text so a repeat investigation does not re-embed the catalog.
import type { CatalogTable, LLM } from '../types';

type EmbedFn = (texts: string[], opts?: { inputType?: 'query' | 'passage' }) => Promise<number[][]>;
type MaybeCausa = LLM & { modelId?: string; canEmbed?: () => Promise<boolean> };

const cache = new Map<string, number[]>();
const MAX_CACHE = 5000;

export function tableDocument(t: CatalogTable): string {
  const cols = t.columns.map((c) => `${c.name} (${c.type})${c.description ? `: ${c.description}` : ''}`).join('; ');
  return `${t.fqName}. ${t.description ?? ''} Source type: ${t.origin}. Columns: ${cols}`.slice(0, 2000);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

const STOP = new Set(['the', 'and', 'for', 'why', 'did', 'does', 'what', 'how', 'was', 'were', 'with', 'from', 'after', 'before', 'its', 'than', 'that', 'this', 'into', 'over', 'is', 'of', 'to', 'in', 'a', 'an', 'or', 'vs', 'by', 'on', 'it', 's']);

/** Tokenize, splitting snake_case/camelCase/dotted identifiers, with light stemming (revenues -> revenue). */
export function tokenize(s: string): string[] {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map((t) => (t.length > 4 && t.endsWith('ies') ? t.slice(0, -3) + 'y' : t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));
}

/** Okapi BM25 (k1=1.2, b=0.75) of `query` against each doc. */
export function bm25(query: string, docs: string[]): number[] {
  const toks = docs.map(tokenize);
  const N = docs.length;
  const avg = toks.reduce((s, t) => s + t.length, 0) / Math.max(1, N);
  const df = new Map<string, number>();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);
  const q = [...new Set(tokenize(query))];
  return toks.map((t) => {
    const tf = new Map<string, number>();
    for (const w of t) tf.set(w, (tf.get(w) ?? 0) + 1);
    let score = 0;
    for (const w of q) {
      const f = tf.get(w) ?? 0;
      if (f === 0) continue;
      const n = df.get(w) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (t.length / Math.max(1, avg)))));
    }
    return score;
  });
}

async function embedCached(llm: LLM, model: string, texts: string[], inputType: 'query' | 'passage'): Promise<number[][]> {
  const embed = llm.embed.bind(llm) as EmbedFn;
  const keys = texts.map((t) => `${model}|${inputType}|${t}`);
  const missing = keys.map((k, i) => (cache.has(k) ? -1 : i)).filter((i) => i >= 0);
  if (missing.length > 0) {
    const vecs = await embed(missing.map((i) => texts[i]), { inputType });
    if (vecs.length !== missing.length) throw new Error(`embedding count mismatch: ${vecs.length} != ${missing.length}`);
    if (cache.size + missing.length > MAX_CACHE) cache.clear();
    missing.forEach((idx, j) => cache.set(keys[idx], vecs[j]));
  }
  return keys.map((k) => cache.get(k)!);
}

export function clearSchemaCache() {
  cache.clear();
}

export async function retrieveSchema(args: {
  llm: LLM;
  catalog: CatalogTable[];
  query: string;
  k?: number;
  withinDeadline?: <T>(p: Promise<T>) => Promise<T>;
}): Promise<{ tables: CatalogTable[]; method: 'bm25' | 'bm25+embedding'; scores: { fqName: string; score: number }[]; error?: string }> {
  const k = args.k ?? 6;
  const wrap = args.withinDeadline ?? (<T>(p: Promise<T>) => p);
  const llm = args.llm as MaybeCausa;
  const docs = args.catalog.map(tableDocument);
  const lex = bm25(args.query, docs);
  const maxLex = Math.max(1e-9, ...lex);
  let scores = lex.map((s) => s / maxLex); // 0..1
  let method: 'bm25' | 'bm25+embedding' = 'bm25';
  let error: string | undefined;
  const canEmbed = llm.canEmbed ? await wrap(llm.canEmbed()).catch(() => false) : false;
  if (canEmbed && docs.length > 0) {
    try {
      const model = llm.modelId ?? 'default';
      const [qv] = await wrap(embedCached(llm, model, [args.query], 'query'));
      const dv = await wrap(embedCached(llm, model, docs, 'passage'));
      scores = scores.map((s, i) => 0.5 * s + cosine(qv, dv[i]));
      method = 'bm25+embedding';
    } catch (e) {
      error = (e as Error).message;
    }
  }
  const ranked = args.catalog.map((t, i) => ({ t, score: scores[i] })).sort((a, b) => b.score - a.score).slice(0, k);
  return { tables: ranked.map((s) => s.t), method, scores: ranked.map((s) => ({ fqName: s.t.fqName, score: Number(s.score.toFixed(4)) })), error };
}
