# Java Step Completion

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/autocomplete/StepCompletionProvider.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/StepUtil.java`

Target behavior:
- Java `@Step` declarations are offered as local Gauge step-line completions.
- Unopened Java source files are included in completion workspace scans.
- Kotlin constant-backed step completion remains resolved through Kotlin-only constant analysis.

RED:
- Command: `node --test test/dynamicArgumentCompletion.test.js --test-name-pattern "unopened workspace Java Step aliases"`
- Result: failed before implementation, with no completion labels instead of `Pay with <card>`.

GREEN:
- Command: `node --test test/dynamicArgumentCompletion.test.js`
- Result: passed, 38 tests.

Broader checks:
- Command: `node --check src/dynamicArgumentCompletion.js`
- Result: passed.
- Command: `npm run check`
- Result: passed, 669 unit tests, 25 LSP tests, 33 VS Code surface tests, and VSIX packaging.
- Command: `git diff --check`
- Result: passed.
- Command: `../.codex/hooks/check-source-language.sh`
- Result: passed.
