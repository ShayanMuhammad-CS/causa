// Regenerates data/sql/*.sql, data/csv/us_macro_indicators.csv and server/fixtures/zetaris/raw_tables.json.
//   npx tsx ../data/generate-sql.ts      (from causa/server)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, type TagsUsed } from './lib/sqlgen.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, '../server/fixtures/zetaris');

export function macroCsv(rows: { country_code: string; indicator_id: string; indicator_name: string; year: number; value: number | null }[]): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return ['country_code,indicator_id,indicator_name,year,value', ...rows.map((r) => [r.country_code, r.indicator_id, q(r.indicator_name), r.year, r.value ?? ''].join(','))].join('\n') + '\n';
}

export function loadTagsUsed(): TagsUsed {
  return JSON.parse(readFileSync(path.join(fixtures, 'sources.json'), 'utf8')).tagsUsed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const g = generate(loadTagsUsed());
  mkdirSync(path.join(here, 'sql'), { recursive: true });
  mkdirSync(path.join(here, 'csv'), { recursive: true });
  for (const f of g.files) writeFileSync(path.join(here, 'sql', f.name), f.content);
  writeFileSync(path.join(fixtures, 'raw_tables.json'), JSON.stringify(g.rawTables, null, 1) + '\n');
  writeFileSync(path.join(here, 'csv', 'us_macro_indicators.csv'), macroCsv(JSON.parse(readFileSync(path.join(fixtures, 'us_macro_indicators.json'), 'utf8'))));
  console.log(`wrote ${g.files.length} sql files, ${g.rawTables.length} raw tables`);
}
