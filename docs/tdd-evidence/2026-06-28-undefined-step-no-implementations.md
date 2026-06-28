# Undefined Step Diagnostics Without Implementations

Scope: LNG-B1 reports undefined Gauge steps when workspace implementation discovery completes and finds no Kotlin step implementations or concept headings.

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/annotator/StepAnnotator.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/annotator/AnnotationHelper.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/StepUtil.java`

Target files:
- `src/stepDiagnostics.js`
- `test/stepDiagnostics.test.js`

RED:
- Command: `node --test --test-name-pattern "no implementations exist" test/stepDiagnostics.test.js`
- Result: failed, 0 passed and 1 failed.
- Failing test: `GaugeStepDiagnosticsProvider reports undefined Gauge steps when no implementations exist`.
- Failure: the Gauge step produced no diagnostic because an empty implementation candidate set was returned as `undefined`.

GREEN:
- Command: `node --test --test-name-pattern "no implementations exist" test/stepDiagnostics.test.js`
- Result: passed, 1 test passed.

Related checks:
- Command: `node --test test/stepDiagnostics.test.js test/stepCodeActions.test.js test/argumentCodeActions.test.js test/dynamicArgumentCompletion.test.js`
- Result: passed, 245 tests passed.

Broad check:
- Command: `npm run check`
- Result: passed.
- Unit tests: 588 passed.
- LSP tests: 20 passed.
- VS Code tests: 24 passed.
- Package: passed.
