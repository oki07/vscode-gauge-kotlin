# Spec Explorer Machine Readable Runs

Reference source:
- `references/gauge-vscode/src/explorer/specExplorer.ts`
- `references/gauge-vscode/src/execution/executor.ts`

Target behavior:
- Spec Explorer run commands use Gauge machine-readable output so execution events can update the VS Code Test UI sink.
- Explorer run all, run node, and debug node pass the same `hide-suggestion` and `machine-readable` flags used by editor run CodeLens and Test UI runs.

RED:
- Command: `node --test test/specExplorer.test.js`
- Result: failed before implementation.
- Failing test:
  - `SpecNodeProvider registers explorer commands`

GREEN:
- Command: `node --test test/specExplorer.test.js`
- Result: passed, 5 tests.

Broader checks:
- Command: `npm run check`
- Result: passed, 654 unit tests, 25 LSP tests, 31 VS Code surface tests, and VSIX packaging.
- Command: `git diff --check`
- Result: passed.
- Command: `../.codex/hooks/check-source-language.sh`
- Result: passed.
