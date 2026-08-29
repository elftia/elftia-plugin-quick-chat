# Elftia Quick Chat

Standalone producer for the default Elftia Quick Chat surface. It contributes one opaque renderer surface backed by the Host-owned Local Channel transport and one main capability provider for bounded surface lifecycle requests.

The only integration input is a clean, committed `dist/quick-chat` tree. Do not consume this repository's source, `node_modules`, or an uncommitted build.

## Commands

- `npm ci` — install the locked standalone dependency tree.
- `npm run verify` — format, lint, typecheck, test, build, contract/artifact gates, and independent plugin-kit verification.
- `npm run verify:repro` — compare two isolated deterministic builds byte-for-byte.
- `npm run pack` — emit the clean plugin archive under `release/`.

The build contract deliberately keeps npm package version `1.46.0` separate from embedded Host API version `1.57.0`. See `contract/plugin-types.provenance.json`.
