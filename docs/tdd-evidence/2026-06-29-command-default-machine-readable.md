# Command Default Machine Readable Execution

Reference source:
- `references/gauge-vscode/package.json`
- `references/gauge-vscode/src/execution/executor.ts`
- `references/gauge-vscode/src/testController.ts`
- `src/codeLensProvider.js`
- `src/explorer/specExplorer.js`

Target behavior:
- Registered Gauge execution commands default to Test UI execution flags when no explicit flags are supplied.
- Explicit execution flags from CodeLens, Spec Explorer, and Test UI are preserved.
- Scenario-at-cursor, failed, and repeat execution paths keep `hide-suggestion` and `machine-readable` flags.
- Failed and repeat run argument builders still ignore spec and launch filters, but keep Test UI event flags.

RED:
- Command: `node --test test/extension.test.js test/execution/executor.test.js test/execution/runArgs.test.js test/testController.test.js --test-name-pattern "execution commands delegate|execute scenario at cursor accepts command flags|failed and repeat execution accept|keeps Test UI flags|failed run profile"`
- Result: failed, 110 passed and 7 failed.
- Failing tests:
  - `execution commands delegate to the Gauge execution controller`
  - `execute scenario at cursor accepts command flags for Test UI events`
  - `failed and repeat execution accept command flags for Test UI events`
  - `buildRunArgs.forGauge keeps Test UI flags for failed and repeat runs`
  - `buildRunArgs.forGradle keeps Test UI flags for failed and repeat runs`
  - `buildRunArgs.forMaven keeps Test UI flags for failed and repeat runs`
  - `GaugeTestController registers a failed run profile for Test UI reruns`

GREEN:
- Command: `node --test test/extension.test.js test/execution/executor.test.js test/execution/runArgs.test.js test/testController.test.js --test-name-pattern "execution commands delegate|execute scenario at cursor accepts command flags|failed and repeat execution accept|keeps Test UI flags|failed run profile"`
- Result: passed, 117 tests.

Broader checks:
- Command: `npm run check`
- Result: passed, 660 unit tests, 25 LSP tests, 32 VS Code surface tests, and VSIX packaging.
- Command: `git diff --check`
- Result: passed.
- Command: `../.codex/hooks/check-source-language.sh`
- Result: passed.
