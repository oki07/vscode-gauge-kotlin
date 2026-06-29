# Workspace Project Test Refresh

## Reference Source

- `references/gauge-vscode/src/gaugeWorkspace.ts`
- `references/gauge-vscode/src/explorer/specExplorer.ts`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/SpecsExecutionProducer.java`

## RED

- Command: `node --test test/gaugeWorkspace.test.js --test-name-pattern "notifies project listeners after workspace folder addition"`
- Result: failed.
- Failure: workspace project listeners were notified only after folder removal, not after folder addition.
- Command: `node --test test/testController.test.js --test-name-pattern "prunes removed client workspace tests"`
- Result: failed.
- Failure: `GaugeTestController` did not subscribe to project changes, so removed-client workspace-discovered test items stayed in Test UI.
- Command: `node --test test/extension.test.js --test-name-pattern "activation starts Gauge workspace services for Gauge projects"`
- Result: failed.
- Failure: activation did not connect `GaugeWorkspace.onDidChangeProjects` to Test UI refresh.

## GREEN

- Command: `node --test test/gaugeWorkspace.test.js --test-name-pattern "notifies project listeners after workspace folder addition|starts and stops clients as workspace folders change|notifies project listeners after workspace folder removal"`
- Result: passed, 23 tests.
- Command: `node --test test/testController.test.js --test-name-pattern "prunes removed client workspace tests|refreshes and prunes workspace tests"`
- Result: passed, 21 tests.
- Command: `node --test test/extension.test.js --test-name-pattern "activation starts Gauge workspace services for Gauge projects"`
- Result: passed, 25 tests.

## Broader Check

- Command: `git diff --check`
- Result: passed.
- Command: `npm run check`
- Result: passed, including 693 unit tests, 27 LSP tests, 36 VS Code and manifest tests, and packaging.

## Change

- Notified workspace project listeners whenever the active Gauge project root set changes.
- Added Test UI project-change subscription support.
- Pruned workspace-discovered Test UI items for clients that were removed from the active project map before rediscovery.
- Wired activation so `GaugeWorkspace` project changes refresh Test UI discovery.
