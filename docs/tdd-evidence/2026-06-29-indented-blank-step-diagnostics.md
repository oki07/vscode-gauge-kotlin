# Indented Blank Step Diagnostics

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_SpecLexer.flex`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_ConceptLexer.flex`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/annotator/StepAnnotator.java`

## RED

- Command: `node --test test/stepDiagnostics.test.js --test-name-pattern "reports blank Gauge steps"`
- Result: failed, 198 passed and 1 failed.
- Failure reason: indented blank markers such as `  *` and `  *   ` still produced `Step should not be blank` diagnostics.

## GREEN

- Command: `node --test test/stepDiagnostics.test.js --test-name-pattern "reports blank Gauge steps"`
- Result: passed, 199 tests.

- Command: `node --test test/stepDiagnostics.test.js`
- Result: passed, 199 tests.

## Broader Checks

- Command: `npm run check`
- Result: passed, 679 unit tests, 26 LSP tests, 36 VS Code surface tests, and VSIX packaging.

## Change

- Blank step diagnostics now apply only to row-start Gauge step markers.
- Indented blank `*` markers are treated consistently with other editor features that classify indented step markers as comments.
