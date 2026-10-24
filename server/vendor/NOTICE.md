# Third-party notices

## H-MEM reference implementation (vendor/hmem)

- Project: Meterless H-MEM, `engines/hmem/reference`
- Source: https://github.com/Meterless/Meterless (commit 1742dec56a66e58eef9dda2d2b865823758ca8cd)
- License: Apache License 2.0 (full text in `vendor/hmem/LICENSE`, copied from `engines/hmem/LICENSE`)
- Copyright: Meterless contributors

Copied files: `src/`, `test/`, `package.json`, `tsconfig.json`, `README.md`.

Modification (the only one): relative imports were rewritten from `./x.ts` to `./x.js`
so the sources typecheck under this project's `moduleResolution: Bundler` without
`allowImportingTsExtensions`. No logic was changed. The upstream test suite
(`test/smoke.test.ts`) passes unchanged otherwise: run
`npx vitest run --root vendor/hmem` from `server/`.

The reference has zero runtime dependencies.
