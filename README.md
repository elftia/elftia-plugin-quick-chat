# Elftia Quick Chat

Standalone producer for the default Elftia Quick Chat surface. It contributes one complete `dedicated-window-v1` renderer application backed by the Host-owned Local Channel transport and one main capability provider for bounded surface lifecycle requests.

The Host owns the native window, resource admission, and fixed Local Channel identity. This plugin owns every descendant of the supplied renderer root, including React, semantic DOM, CSS, title chrome, focus, scrolling, localization, theme projection, composer controls, and the close button. It does not receive Host React/UI, native window APIs, or endpoint/chat selectors.

The only integration input is a clean, committed `dist/quick-chat` tree. Do not consume this repository's source, `node_modules`, or an uncommitted build.

## Commands

- `npm ci` — install the locked standalone dependency tree.
- `npm run verify` — format, lint, typecheck, test, build, contract/built-runtime/artifact gates, and independent plugin-kit verification.
- `npm run verify:repro` — compare two isolated deterministic builds byte-for-byte.
- `npm run pack` — emit the clean plugin archive under `release/`.

The build contract deliberately keeps npm package version `1.46.0` separate from embedded Host API version `1.58.0`. See `contract/plugin-types.provenance.json`.
