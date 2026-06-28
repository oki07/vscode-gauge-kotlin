# Test Controller Debug And Cancellation

Scope: Test Explorer parity batch.

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/GaugeCommandLineState.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/GaugeRunProcessHandler.java`
- `references/gauge-vscode/src/execution/gaugeExecutor.ts`

Target files:
- `src/testController.js`
- `test/testController.test.js`

Notes:
- The worktree already contained the Debug Test Explorer profile changes before this batch started.
- This batch kept those changes, added cancellation support, and verified the combined Test Explorer behavior.

RED:
- Command: `node --test test/testController.test.js`
- Result: failed, 8 passed and 1 failed.
- Failing test: `GaugeTestController stops Gauge execution when Test UI run is cancelled`.
- Failure: cancellation did not call `gauge.stopExecution`.

GREEN:
- Command: `node --test test/testController.test.js`
- Result: passed, 9 tests passed.

Related checks:
- Command: `node --test test/testController.test.js test/extension.test.js test/execution/executor.test.js`
- Result: passed, 65 tests passed.
- Command: `npm run check`
- Result: passed.
- Unit tests: 581 passed.
- LSP tests: 20 passed.
- VS Code manifest/extension tests: 24 passed.
- Package step: passed.
