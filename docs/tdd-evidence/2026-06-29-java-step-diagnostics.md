# Java Step Diagnostics

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/Locators.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/annotator/ParamAnnotator.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/StepUtil.java`

Target behavior:
- Java `@Step` declarations are treated as Gauge step implementations for local undefined-step diagnostics.
- Unopened Java source files are included in workspace implementation scans.
- Java `@Step` methods report parameter count mismatches the same way Kotlin `@Step` functions do.

RED:
- Command: `node --test test/stepDiagnostics.test.js --test-name-pattern "unopened Java Step files"`
- Result: failed before implementation, with the Gauge spec step reported as `Undefined Step`.
- Command: `node --test test/stepDiagnostics.test.js --test-name-pattern "Java Step parameter|unopened Java Step"`
- Result: failed before implementation, with 2 failing Java diagnostics tests.

GREEN:
- Command: `node --test test/stepDiagnostics.test.js --test-name-pattern "Java Step parameter|unopened Java Step"`
- Result: passed after implementation.
- Command: `node --test test/stepDiagnostics.test.js`
- Result: passed, 199 tests.

Broader checks:
- Command: `node --check src/stepDiagnostics.js`
- Result: passed.
- Command: `git diff --check -- src/stepDiagnostics.js test/stepDiagnostics.test.js`
- Result: passed.
- Command: `npm run check`
- Result: passed, 667 unit tests, 25 LSP tests, 33 VS Code surface tests, and VSIX packaging.
- Command: `../.codex/hooks/check-source-language.sh`
- Result: passed.
