# Markdown language association

Reference behavior:
- `references/gauge-vscode/package.json` contributes the Gauge language for
  `.spec` and `.cpt` files, not all `.md` files.
- `references/gauge-vscode/src/explorer/specExplorer.ts` still treats `.md`
  files as runnable Gauge specification candidates.

Target behavior:
- The local manifest no longer claims `.md` as a Gauge language extension.
- Markdown Gauge specifications continue to use the existing Markdown-specific
  selectors, snippets, commands, and Test UI discovery gates.

RED:
- `node --test test/manifest.test.js --test-name-pattern "core Gauge VS Code surface"`
- Result: failed before implementation because the Gauge language extensions
  still included `.md`.

GREEN:
- `node --test test/manifest.test.js --test-name-pattern "core Gauge VS Code surface"`
- `node --test test/manifest.test.js`
- Result: passed after implementation with 11 passing tests.
