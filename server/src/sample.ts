// `npm run sample`: start the server in SAMPLE_MODE on any OS (no cross-env needed). Data = DuckDB over the real
// SEC EDGAR / World Bank fixtures; model = Meterless Nightshift if it answers, else the deterministic sample analyst.
process.env.SAMPLE_MODE = 'true';
const { main } = await import('./index');
main().catch((e) => {
  console.error('[causa] failed to start:', e);
  process.exit(1);
});
export {};
