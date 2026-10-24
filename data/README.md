# data/ : Zetaris onboarding for Causa

Lightning SQL scripts that create, in a real Zetaris instance, the same sources the offline fake (`CAUSA_FAKE=1`) serves from `server/fixtures/zetaris/`. **Everything here is UNVERIFIED against a live instance** (it was written while the instance was not running). Patterns are adapted from the vendored `zetaris-getting-started/open_data` recipes; each generated file header cites its source.

| Step | File | Creates |
|---|---|---|
| 00 | `sql/00_databases_containers.sql` | Lightning DBs `SEC_DATA`, `COMPANY_DNS`, `WORLDBANK_REST`; schemastore containers `edgar`, `edgar_stage`, `company_dns`, `worldbank` |
| 10 | `sql/10_company_dns_sic.sql` | company_dns V4 REST table (cached) and views `company_dns.sic_codes_v4_table`, `company_dns.sic_codes_v4_compat_table` |
| 20 | `sql/20_edgar_raw_tables.sql` | 66 raw REST tables: EDGAR `companyconcept` per company + XBRL tag actually used, plus `submissions` per company |
| 21 | `sql/21_edgar_cache.sql` | `CACHE TABLE` for each (a REST table refetches on every query) |
| 30 | `sql/30_edgar_stage_views.sql` | One flattening view per raw tag table (`edgar_stage.*`): 10-K, FY, 350-380 day duration |
| 40 | `sql/40_edgar_final_views.sql` | **`edgar.company_financials`** (window-deduped union, one row per ticker/concept/fiscal_year) and **`edgar.company_profile`** (submissions LEFT JOIN SIC hierarchy) |
| 50 | `sql/50_worldbank_macro.sql` | World Bank REST tables and **`worldbank.us_macro_indicators`** |
| 60 | `sql/60_usl_sic_edgar.sql` | USL `sic_edgar_usl` (`company` FK-> `sic_code`), activated, `RUN DQ` |
| 70 | `sql/70_verify.sql` | Read-only checks |

`csv/us_macro_indicators.csv` is the World Bank fallback (see risks).

## Run

```bash
cd server
npx tsx ../data/generate-sql.ts        # regenerate sql/ + csv/ + fixtures/raw_tables.json (tests fail if they drift)
npx tsx ../data/run-onboarding.ts      # DRY RUN (default): prints every statement, sends nothing
npx tsx ../data/run-onboarding.ts --apply --only 00,10 --skip-exists   # really run, selected steps
```

Needs in `server/.env.local`: `ZETARIS_API_KEY` (use an admin key here, a read-only one for the agent), `ZETARIS_ORG_ID` (numeric), optional `ZETARIS_REST_URL` (default `http://localhost:8888/api/v1.0`), and `ZETARIS_USER_AGENT="app_name user@domain.tld"` (filled into the `YOUR_APP_NAME YOUR_CONTACT_EMAIL` placeholder; the runner refuses vague values like `run_sql.py`). One statement per call; a multi-table `COMPILE USL` is kept whole. Pacing: `--delay-ms` (default 300, SEC allows 10 req/s), HTTP 429 waits `--rate-wait-ms` (60 s) and retries that statement once. Stops at the first error. Run steps 10, 20, 21 deliberately: they hit external APIs.

## Live-instance checklist (what to verify first)

1. **Response columns.** The documented run response is `{"data": [[...strings...]]}` with no column names. `rest.ts` looks for names under `columns/schema/header/headers/fields`, accepts object rows, else derives names from the SELECT list (`col_N` for `*`, SHOW, DESCRIBE). Run `SELECT 1 AS one` and a `SELECT *` and inspect the raw JSON.
2. **Catalog statements.** Column layouts of `SHOW LIGHTNING DATABASES/TABLES`, `SHOW DATASOURCE VIEWS`, `DESCRIBE <container>.<view>`, `SHOW NAMESPACES OR TABLES IN` are guessed (positional). `catalog()` records non-fatal problems in `lastCatalogWarnings`.
3. **World Bank.** The API returns a top-level JSON array `[meta, [rows]]`; whether Zetaris accepts that, and how it exposes elements, is untested (companion guide section 2). If step 50 fails: upload `csv/us_macro_indicators.csv` as a filestore table and `CREATE SCHEMASTORE VIEW worldbank.us_macro_indicators` over it with the same columns.
4. **Instant facts.** `InventoryNet` JSON has no `start` field; the view selects `CAST(NULL AS STRING)` instead. Confirm the REST table infers the schema that way.
5. **Window function over the large UNION ALL** in `edgar.company_financials` (companion guide section 4 warns about repeated references to UNION ALL of explode views). Fallback noted in the file header.
6. **USL activation from the V4 raw table** (recipe only tested the V3 table) and `date_sub` / `datediff` Spark functions in the stage views.
7. Compare `70_verify.sql` counts against `fixtures/zetaris/sources.json` and against data.sec.gov directly.

No teardown is scripted: per the recipes, `DROP VIEW` is the only reliable SQL teardown; REST tables and database registrations are removed in the Zetaris Data Explorer.
