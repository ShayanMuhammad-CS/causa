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

## World Model reference implementation (vendor/world-model)

- Project: Meterless World Model, `engines/world-model/reference`
- Source: https://github.com/Meterless/Meterless (commit 1742dec56a66e58eef9dda2d2b865823758ca8cd)
- License: Apache License 2.0 (full text in `vendor/world-model/LICENSE`, copied from `engines/world-model/LICENSE`)
- Copyright: Meterless contributors

Copied files: `src/`, `test/`, `package.json`, `tsconfig.json`, `README.md` (the browser-bundle
`scripts/` were not copied). Modification (the only one): relative imports `./x.ts` -> `./x.js`
for `moduleResolution: Bundler`. No logic changed. Upstream tests: `npx vitest run --root vendor/world-model`.
Zero runtime dependencies.

## Markovian reference implementation (vendor/markovian)

- Project: Meterless Markovian engine, `engines/markovian/reference`
- Source: https://github.com/Meterless/Meterless (commit 1742dec56a66e58eef9dda2d2b865823758ca8cd)
- License: Apache License 2.0 (full text in `vendor/markovian/LICENSE`, copied from `engines/markovian/LICENSE`)
- Copyright: Meterless contributors

Copied files: `src/`, `test/`, `package.json`, `tsconfig.json`, `README.md` (`scripts/measured-run.ts`
not copied). Modification (the only one): relative imports `./x.ts` -> `./x.js`. No logic changed.
Upstream tests: `npx vitest run --root vendor/markovian`. Zero runtime dependencies.
