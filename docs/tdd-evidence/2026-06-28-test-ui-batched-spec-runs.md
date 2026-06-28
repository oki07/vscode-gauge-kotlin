# Test UI Batched Specification Runs

Scope: EXEC-A2 batches multiple included specification Test Explorer items into one Gauge execution request.

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/SpecsExecutionProducer.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/GaugeRunConfiguration.java`
- `references/gauge-vscode/src/execution/gaugeExecutor.ts`

Target files:
- `src/testController.js`
- `test/testController.test.js`

RED:
- Command: `node --test --test-name-pattern "batches multiple included specification" test/testController.test.js`
- Result: failed, 0 passed and 1 failed.
- Failing test: `GaugeTestController batches multiple included specification items into one execution request`.
- Failure: included specification items were executed as separate `gauge.execute` calls instead of one selected-resource specification run.

GREEN:
- Command: `node --test --test-name-pattern "batches multiple included specification" test/testController.test.js`
- Result: passed, 1 test passed.

Related checks:
- Command: `node --test test/testController.test.js test/execution/executor.test.js test/extension.test.js`
- Result: passed, 67 tests passed.

Broad check:
- Command: `npm run check`
- Result: passed.
- Unit tests: 587 passed.
- LSP tests: 20 passed.
- VS Code tests: 24 passed.
- Package: passed.
