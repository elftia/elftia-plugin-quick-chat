# Elftia Quick Chat

Standalone producer for the default Elftia Quick Chat surface. It contributes one complete `dedicated-window-v1` renderer application backed by the Host-owned Local Channel transport and one main capability provider for bounded surface lifecycle requests.

The Host owns the native window, resource admission, and fixed Local Channel identity. This plugin owns every descendant of the supplied renderer root, including React, semantic DOM, CSS, title chrome, focus, scrolling, localization, theme projection, composer controls, and the close button. It does not receive Host React/UI, native window APIs, or endpoint/chat selectors.

The only integration input is a clean, committed `dist/quick-chat` tree. Do not consume this repository's source, `node_modules`, or an uncommitted build.

## Commands

- `npm ci` — install the locked standalone dependency tree.
- `npm run verify` — format, lint, typecheck, test, build, contract/built-runtime/artifact gates, and independent plugin-kit verification.
- `npm run verify:repro` — compare two isolated deterministic builds byte-for-byte.
- `npm run pack` — emit the clean plugin archive under `release/`.

## Host API 2 migration

Quick Chat `0.2.0` requires Host API `2.0.0` for both its main provider and dedicated-window renderer (`requiredMajor: 2`, `requiredMinor: 0`). Its scoped Local Channel, close intent, capabilities, permissions, and renderer ownership are unchanged. Conversation model selection remains Host-owned; this producer has no default/background/vision LLM selector calls or plugin-owned model state.

The only SDK input is `file:vendor/elftia-plugin-types-2.0.0.tgz`, built and packed from the canonical Host SDK. `manifest/elftia-plugin.source.json` remains the manifest source; `npm run build` generates `dist/quick-chat`, contribution checksums, provenance copies, and integrity metadata. Do not hand-edit generated artifacts.

`npm run verify:contract` checks the checksum-free source manifest and lockfile identity as well as the SDK archive. The finished-tree gate independently pins both code contributions to Host API 2.0.0, with negative artifact cases for major, minor, and built-against drift on each contribution. These checks do not replace provenance, integrity, runtime-boundary, or reproducibility gates.

The vendored SDK is qualified from canonical source commit `658350268537e8ab83d208665b82565ace6b7224`, tree `08c096c10d2e9fb20c54a0b3cf06e52288836202`, with the merged latest host contracts, CJS/ESM/DTS builds, and `npm pack`. `contract/plugin-types.provenance.json` records the genuine archive identity and qualification; independent source/digest pins in `scripts/verify-contract.mjs` and `scripts/artifact-policy.mjs` enforce it against the vendored bytes and locked dependency. This is a source-provenance refresh, not a change to package or Host API version.

Run `npm ci`, `npm run verify`, `npm run verify:repro`, and `npm run pack` to reproduce the qualified producer output. The archive is `release/quick-chat-0.2.0.tgz`. Rebuilt `dist/quick-chat` must be committed before consumers update their Fleet pin.
