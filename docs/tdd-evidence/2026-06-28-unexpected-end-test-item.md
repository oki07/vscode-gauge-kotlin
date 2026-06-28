# Unexpected End Test Item

Scope: EXEC-A3 reports a synthetic Test Explorer result when a machine-readable Gauge run exits before any test event is emitted.

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/runner/GaugeOutputToGeneralTestEventsProcessor.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/runner/processors/UnexpectedEndProcessor.java`
- `references/intellij-gauge-plugin/tests/com/thoughtworks/gauge/execution/runner/processors/UnexpectedEndProcessorTest.java`

Target files:
- `src/execution/executor.js`
- `test/execution/executor.test.js`

RED:
- Command: `node --test --test-name-pattern "synthetic failed event" test/execution/executor.test.js`
- Result: failed, 0 passed and 1 failed.
- Failing test: `machine-readable Test UI run emits synthetic failed event when Gauge exits before test events`.
- Failure: the execution event sink received no events when a machine-readable run returned `false` before any Gauge test event.

GREEN:
- Command: `node --test --test-name-pattern "synthetic failed event" test/execution/executor.test.js`
- Result: passed, 1 test passed.

Related checks:
- Command: `node --test test/execution/executor.test.js test/execution/lineProcessors.test.js test/testController.test.js`
- Result: passed, 55 tests passed.

Broad check:
- Command: `npm run check`
- Result: passed.
- Unit tests: 586 passed.
- LSP tests: 20 passed.
- VS Code tests: 24 passed.
- Package: passed.
