# Indented Rename Step

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/rename/CustomRenameHandler.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/findUsages/StepCollector.java`

## RED

- Command: `node --test test/renameProvider.test.js --test-name-pattern "indented pseudo-step"`
- Result: failed, 9 passed and 1 failed.
- Failure reason: `prepareRename` treated an indented `  * Pay with <amount>` line as a Gauge step.

## GREEN

- Command: `node --test test/renameProvider.test.js --test-name-pattern "indented pseudo-step"`
- Result: passed, 10 tests.

- Command: `node --test test/renameProvider.test.js`
- Result: passed, 10 tests.

## Broader Checks

- Command: `npm run check`
- Result: passed, 682 unit tests, 26 LSP tests, 36 VS Code surface tests, and VSIX packaging.

## Change

- `prepareRename` now ignores indented pseudo-step lines, matching the Gauge lexer rule that recognizes step markers only at line start.
