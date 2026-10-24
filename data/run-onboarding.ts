// Runs data/sql/*.sql against a Zetaris instance, ONE statement per call, through RestZetarisClient.
//   npx tsx ../data/run-onboarding.ts                       dry-run (default): prints every statement, sends nothing
//   npx tsx ../data/run-onboarding.ts --apply               really run (needs ZETARIS_API_KEY, ZETARIS_ORG_ID, ZETARIS_USER_AGENT)
//   --only 10,20            run only files whose number prefix is listed
//   --skip-exists           treat "already exists" errors as skipped (CREATE SCHEMASTORE CONTAINER has no IF NOT EXISTS)
//   --delay-ms 300          pause between statements (SEC allows 10 req/s; company_dns: be gentle)
//   --rate-wait-ms 60000    wait after an HTTP 429 and retry that one statement (once)
//   --verbose               print full statements (dry-run default prints one line each)
// Run it with an ADMIN key; the agent should use a separate read-only key. UNVERIFIED against a live instance.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RestZetarisClient, restConfigFromEnv } from '../server/src/zetaris/rest.js';
import { applyUserAgent, splitStatements } from './lib/split.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface Plan { file: string; statements: string[] }

export function buildPlan(sqlDir: string, only?: string[]): Plan[] {
  return readdirSync(sqlDir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()
    .filter((f) => !only || only.includes(f.split('_')[0]!))
    .map((file) => ({ file, statements: splitStatements(readFileSync(path.join(sqlDir, file), 'utf8')) }));
}

const oneLine = (s: string, n = 110) => { const t = s.split(/\s+/).join(' '); return t.length <= n ? t : t.slice(0, n - 3) + '...'; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadEnvFile(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith('#') || !l.includes('=')) continue;
    const i = l.indexOf('=');
    let v = l.slice(i + 1).trim();
    if (v.length >= 2 && v[0] === v[v.length - 1] && '\'"'.includes(v[0]!)) v = v.slice(1, -1);
    process.env[l.slice(0, i).trim()] ??= v;
  }
}

export async function main(argv: string[]): Promise<number> {
  const flag = (n: string) => argv.includes(`--${n}`);
  const val = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const apply = flag('apply');
  const verbose = flag('verbose');
  const delay = Number(val('delay-ms') ?? 300);
  const rateWait = Number(val('rate-wait-ms') ?? 60_000);
  loadEnvFile(path.resolve(here, '../server/.env.local'));

  const plan = buildPlan(path.join(here, 'sql'), val('only')?.split(','));
  let total = 0;
  const ua = process.env.ZETARIS_USER_AGENT;
  for (const p of plan) {
    try { p.statements = applyUserAgent(p.statements, ua); }
    catch (e) { if (apply) { console.error(`error: ${(e as Error).message}`); return 1; } console.error(`warning (${p.file}): ${(e as Error).message}`); }
    total += p.statements.length;
  }
  if (!apply) {
    for (const p of plan) {
      console.log(`\n== ${p.file} (${p.statements.length} statements)`);
      p.statements.forEach((s, i) => console.log(verbose ? `${String(i + 1).padStart(3)}.\n${s}\n` : `${String(i + 1).padStart(3)}. ${oneLine(s)}`));
    }
    console.log(`\n${total} statements in ${plan.length} files (dry run, nothing sent). Pass --apply to execute.`);
    return 0;
  }

  const client = new RestZetarisClient(restConfigFromEnv(process.env));
  const health = await client.health();
  console.log(`health: ${health.ok ? 'ok' : 'FAILED'} - ${health.detail}`);
  if (!health.ok) return 1;
  let ok = 0, skipped = 0;
  for (const p of plan) {
    console.log(`\n== ${p.file}`);
    for (const [i, stmt] of p.statements.entries()) {
      console.log(`${String(i + 1).padStart(3)}. ${oneLine(stmt)}`);
      for (let attempt = 1; ; attempt++) {
        try {
          const r = await client.unsafeExecuteStatement(stmt);
          for (const row of r.rows.slice(0, 5)) console.log('      ', JSON.stringify(row));
          ok++;
          break;
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          if (/429/.test(m) && attempt === 1) { console.log(`      HTTP 429, waiting ${rateWait} ms then retrying this statement once`); await sleep(rateWait); continue; }
          if (flag('skip-exists') && /already exists/i.test(m)) { skipped++; console.log('      skipped (already exists)'); break; }
          console.error(`      ERROR ${m}\nSTOPPED at ${p.file} statement ${i + 1}; fix and re-run with --only ${p.file.split('_')[0]} --skip-exists`);
          return 1;
        }
      }
      await sleep(delay);
    }
  }
  console.log(`\ndone: ${ok}/${total} ok${skipped ? `, ${skipped} skipped` : ''}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
}
