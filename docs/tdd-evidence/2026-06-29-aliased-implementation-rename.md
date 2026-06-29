# Aliased Implementation Rename

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/rename/CustomRenameHandler.java`

## RED

- Command: `node --test test/renameProvider.test.js --test-name-pattern "implementation renames for aliased"`
- Result: failed, 10 passed and 1 failed.
- Failure reason: `prepareRename` returned without rejection when invoked inside an aliased Kotlin `@Step` annotation.

## GREEN

- Command: `node --test test/renameProvider.test.js --test-name-pattern "implementation renames for aliased"`
- Result: passed, 11 tests.

- Command: `node --test test/renameProvider.test.js`
- Result: passed, 11 tests.

## Broader Checks

- Command: `npm run check`
- Result: passed, 684 unit tests, 26 LSP tests, 36 VS Code surface tests, and VSIX packaging.

## Change

- Rename preparation now rejects cursor positions inside aliased Kotlin step implementations with the same unsupported-alias error used for spec-side aliased renames.
