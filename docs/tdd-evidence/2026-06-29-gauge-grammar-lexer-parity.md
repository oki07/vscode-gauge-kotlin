# Gauge Grammar Lexer Parity

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_SpecLexer.flex`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_ConceptLexer.flex`

## RED

- Command: `node --test test/manifest.test.js --test-name-pattern "Gauge TextMate grammar follows|Gauge TextMate grammar handles|contributes a Gauge TextMate grammar"`
- Result: failed, 8 passed and 3 failed.
- Failure reason: TextMate grammar had no Gauge teardown rule, required at least three underline characters for legacy headings, and did not match indented table rows or separators.

## GREEN

- Command: `node --test test/manifest.test.js --test-name-pattern "Gauge TextMate grammar follows|Gauge TextMate grammar handles|contributes a Gauge TextMate grammar"`
- Result: passed, 11 tests.

- Command: `node --test test/manifest.test.js`
- Result: passed, 11 tests.

## Broader Checks

- Command: `npm run check`
- Result: passed, 681 unit tests, 26 LSP tests, 36 VS Code surface tests, and VSIX packaging.

## Change

- `___` teardown separators are scoped as Gauge teardown syntax before Markdown separators.
- Legacy underline headings accept one or more `=` or `-` characters.
- Indented table body and separator rows are scoped as Gauge table syntax.
