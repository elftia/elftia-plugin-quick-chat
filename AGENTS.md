# Quick Chat producer rules

- This repository owns the standalone `quick-chat` producer only.
- Consumers must use a committed `dist/quick-chat` tree. Source files, `node_modules`, and uncommitted build output are not integration inputs.
- Do not import Elftia Host implementation modules or sibling repositories. The only Host contract dependency is the digest-pinned tarball in `vendor/`.
- The renderer executes as the complete `dedicated-window-v1` application. It owns the supplied root, bundled React runtime, semantic DOM, CSS, chrome, focus, and scrolling while using only the scoped Quick Chat Host.
- Do not access preload, raw IPC, Node, Electron, `window.native`, Host implementation modules, Pet authority, or caller-selected Local Channel identity.
- Keep all text UTF-8 without BOM and use Windows-compatible npm scripts.
