# Test UI Excluded Items

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/GaugeExecutionProducer.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/ScenarioExecutionProducer.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/SpecsExecutionProducer.java`

Target behavior:
- VS Code Test UI runs honor `request.exclude`.
- Included specifications with excluded scenarios expand to the remaining scenario targets instead of running the whole specification.
- Run-all requests with excludes run known non-excluded targets instead of ignoring exclusions.

RED:
- Command: `node --test test/testController.test.js --test-name-pattern "expands included specifications|included Gauge test items|batches multiple"`
- Result: failed, 17 passed and 1 failed.
- Failing test:
  - `GaugeTestController expands included specifications when scenarios are excluded`

GREEN:
- Command: `node --test test/testController.test.js --test-name-pattern "included Gauge test items|batches multiple|expands included specifications|known tests except excluded|debug profile runs included|forces machine-readable"`
- Result: passed, 19 tests.

Broader checks:
- Command: `npm run check`
- Result: passed, 665 unit tests, 25 LSP tests, 33 VS Code surface tests, and VSIX packaging.
- Command: `git diff --check`
- Result: passed.
- Command: `../.codex/hooks/check-source-language.sh`
- Result: passed.
