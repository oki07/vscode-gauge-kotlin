# Markdown Step Rename

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileTypeFactory.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/rename/CustomRenameHandler.java`

## RED

- Command: `node --test test/renameProvider.test.js --test-name-pattern "Markdown Gauge steps|plaintext Kotlin file rename selector"`
- Result: failed, 10 passed and 2 failed.
- Failure reason: Markdown `.md` Gauge steps were not recognized as rename targets, and the rename provider selector omitted Markdown Gauge specs.

## GREEN

- Command: `node --test test/renameProvider.test.js --test-name-pattern "Markdown Gauge steps|plaintext Kotlin file rename selector"`
- Result: passed, 12 tests.

- Command: `node --test test/renameProvider.test.js`
- Result: passed, 12 tests.

## Broader Checks

- Command: `npm run check`
- Result: passed, 686 unit tests, 26 LSP tests, 36 VS Code surface tests, and VSIX packaging.

## Change

- Rename now treats file-backed `markdown` `.md` files as Gauge step documents.
- Rename registration now includes Markdown Gauge specs alongside Gauge, Kotlin, and Java implementation documents.
