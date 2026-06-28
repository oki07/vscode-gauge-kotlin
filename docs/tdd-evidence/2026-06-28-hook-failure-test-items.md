# Hook Failure Test Items

Scope: EXEC-001 reports Gauge suite and specification hook failures as synthetic VS Code Test Explorer test items.

Reference source:
- `references/intellij-gauge-plugin/src/main/java/com/thoughtworks/gauge/execution/SuiteEventProcessor.java`
- `references/intellij-gauge-plugin/src/main/java/com/thoughtworks/gauge/execution/SpecEventProcessor.java`
- `references/gauge-vscode/src/test/testExecution.ts`

Target files:
- `src/execution/lineProcessors.js`
- `test/execution/lineProcessors.test.js`

RED:
- Command: `node --test test/execution/lineProcessors.test.js`
- Result: failed, 7 passed and 1 failed.
- Failing test: `MachineReadableEventProcessor maps suite and spec hook failures to synthetic tests`.
- Failure: suite and specification hook failure events emitted no synthetic test start, failure, or finish events.

GREEN:
- Command: `node --test test/execution/lineProcessors.test.js`
- Result: passed, 8 tests passed.

Related checks:
- Command: `node --test test/execution/lineProcessors.test.js test/testController.test.js test/execution/executor.test.js`
- Result: passed, 54 tests passed.

Broad check:
- Command: `npm run check`
- Result: passed.
- Unit tests: 585 passed.
- LSP tests: 20 passed.
- VS Code tests: 24 passed.
- Package: passed.
