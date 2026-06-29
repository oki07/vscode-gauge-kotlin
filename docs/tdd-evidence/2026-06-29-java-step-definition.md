# Java Step Definition

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/reference/StepReference.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/reference/ConceptReference.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/StepUtil.java`

Target behavior:
- Gauge spec and concept steps resolve to Java `@Step` methods.
- Unopened Java source files are included in local definition scans.
- Kotlin constant resolution remains scoped to Kotlin documents while Java literal step annotations still participate in matching.

RED:
- Command: `node --test test/stepDefinitionProvider.test.js --test-name-pattern "unopened workspace Java Step functions"`
- Result: failed before implementation, with 0 definitions instead of 1.

GREEN:
- Command: `node --test test/stepDefinitionProvider.test.js`
- Result: passed, 22 tests.

Broader checks:
- Command: `node --check src/stepDefinitionProvider.js`
- Result: passed.
- Command: `npm run check`
- Result: passed, 668 unit tests, 25 LSP tests, 33 VS Code surface tests, and VSIX packaging.
- Command: `git diff --check`
- Result: passed.
- Command: `../.codex/hooks/check-source-language.sh`
- Result: passed.
