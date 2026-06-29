# CodeLens Normal Run Flags

Reference source:
- `references/gauge-vscode/src/execution/gaugeExecutor.ts`
- `references/gauge-vscode/src/execution/runArgs.ts`

Target behavior:
- Normal run/debug CodeLens commands do not force `machine-readable`.
- CodeLens run/debug commands still hide suggestions.
- Test UI execution continues to force `machine-readable` through its own execution path.

RED:
- Command: `node --test test/codeLensProvider.test.js --test-name-pattern "run and debug lenses"`
- Result: failed before implementation, with `machine-readable` still present in CodeLens command flags.

GREEN:
- Command: `node --test test/codeLensProvider.test.js test/execution/runArgs.test.js test/testController.test.js --test-name-pattern "run and debug lenses|machine-readable|Test UI"`
- Result: passed, 60 tests.

Broader checks:
- Command: `node --check src/codeLensProvider.js`
- Result: passed.
- Command: `npm run check`
- Result: passed, 672 unit tests, 25 LSP tests, 33 VS Code surface tests, and VSIX packaging.
- Command: `git diff --check`
- Result: passed.
- Command: `../.codex/hooks/check-source-language.sh`
- Result: passed.
