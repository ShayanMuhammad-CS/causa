// CRITIC pass: an independent Nemotron call reviews each claim against its cited evidence rows, and a
// deterministic numeric check runs regardless. A claim is `verified` only if BOTH pass.
import { z } from 'zod';
import type { Claim, Evidence } from '../types';
import { chatJson, type ChatFn } from '../llm/json';
import { checkClaimNumbers } from './numbers';
import { criticMessages } from './prompts';

const ReviewSchema = z.object({
  reviews: z.array(
    z.object({
      index: z.coerce.number().int(),
      verdict: z.enum(['verified', 'downgrade', 'drop']),
      note: z.string().optional().default(''),
    }),
  ),
});

const LEVELS: Claim['confidence'][] = ['high', 'medium', 'low'];
function lower(c: Claim['confidence'], steps = 1): Claim['confidence'] {
  return LEVELS[Math.min(LEVELS.length - 1, LEVELS.indexOf(c) + steps)];
}

export interface DraftClaim {
  text: string;
  confidence: Claim['confidence'];
  evidenceIds: string[];
}

export interface CriticResult {
  claims: Claim[];
  dropped: { text: string; note: string }[];
  llmCritic: 'ok' | 'unavailable';
  llmError?: string;
}

export async function critique(args: {
  claims: DraftClaim[];
  evidence: Evidence[];
  chat?: ChatFn;          // undefined => LLM critic skipped (budget exhausted)
  thinking?: boolean;
}): Promise<CriticResult> {
  const byId = new Map(args.evidence.map((e) => [e.id, e]));
  const drafts = args.claims.map((c) => ({ ...c, evidenceIds: [...new Set(c.evidenceIds)].filter((id) => byId.has(id)) }));

  let reviews = new Map<number, { verdict: 'verified' | 'downgrade' | 'drop'; note: string }>();
  let llmCritic: CriticResult['llmCritic'] = 'unavailable';
  let llmError: string | undefined;
  const reviewable = drafts.map((c, index) => ({ index, text: c.text, evidenceIds: c.evidenceIds })).filter((c) => c.evidenceIds.length > 0);
  if (args.chat && reviewable.length > 0) {
    const cited = args.evidence.filter((e) => reviewable.some((c) => c.evidenceIds.includes(e.id)));
    try {
      const { value } = await chatJson(args.chat, criticMessages({ claims: reviewable, evidence: cited }), ReviewSchema, {
        thinking: args.thinking ?? true,
        temperature: 0.2,
      });
      reviews = new Map(value.reviews.map((r) => [r.index, { verdict: r.verdict, note: r.note }]));
      llmCritic = 'ok';
    } catch (e) {
      llmError = (e as Error).message;
    }
  } else if (!args.chat) {
    llmError = 'LLM critic skipped: budget exhausted';
  }

  const kept: Claim[] = [];
  const dropped: CriticResult['dropped'] = [];
  drafts.forEach((c, index) => {
    const notes: string[] = [];
    let confidence = c.confidence;
    let verified = true;
    if (c.evidenceIds.length === 0) {
      verified = false;
      confidence = 'low';
      notes.push('No valid evidence cited.');
    }
    const det = checkClaimNumbers(
      c.text,
      c.evidenceIds.map((id) => ({ columns: byId.get(id)!.result.columns, rows: byId.get(id)!.result.rows })),
    );
    if (!det.ok) {
      verified = false;
      confidence = lower(confidence);
      notes.push(`Numeric check: ${det.unsupported.join(', ')} not found in or derivable from ${c.evidenceIds.join(', ') || 'any cited evidence'}.`);
    }
    const r = reviews.get(index);
    if (llmCritic !== 'ok') {
      if (c.evidenceIds.length > 0) {
        verified = false;
        notes.push(`Not reviewed by the LLM critic (${llmError ?? 'unavailable'}).`);
      }
    } else if (!r) {
      if (c.evidenceIds.length > 0) {
        verified = false;
        notes.push('Critic did not review this claim.');
      }
    } else if (r.verdict === 'drop') {
      dropped.push({ text: c.text, note: r.note || 'Critic: unsupported by cited evidence.' });
      return;
    } else if (r.verdict === 'downgrade') {
      verified = false;
      confidence = lower(confidence);
      notes.push(`Critic: ${r.note || 'support is partial.'}`);
    } else if (r.note) {
      notes.push(`Critic: ${r.note}`);
    }
    kept.push({ text: c.text, confidence, evidenceIds: c.evidenceIds, verified, criticNote: notes.join(' ') || undefined });
  });

  // keep the model's ranking, but verified claims first, then by confidence
  const order = (c: Claim) => (c.verified ? 0 : 10) + LEVELS.indexOf(c.confidence);
  const ranked = kept.map((c, i) => ({ c, i })).sort((a, b) => order(a.c) - order(b.c) || a.i - b.i).map((x) => x.c);
  return { claims: ranked, dropped, llmCritic, llmError };
}
