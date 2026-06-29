# Rename Validate Preflight

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/rename/GaugeRefactorHandler.java`
- `vscode-gauge-kotlin/src/validateDiagnostics.js`

## RED

- Command: `node --test test/renameProvider.test.js --test-name-pattern "validate reports errors"`
- Result: failed, 19 passed and 1 failed.
- Failure: local rename fallback returned edits instead of rejecting when `gauge validate` reported an error.

## GREEN

- Command: `node --test test/renameProvider.test.js --test-name-pattern "validate reports errors"`
- Result: passed, 20 tests.
- Command: `node --test test/renameProvider.test.js test/validateDiagnostics.test.js test/extension.test.js`
- Result: passed, 52 tests.

## Broader Check

- Command: `npm run check`
- Result: passed, including 714 unit tests, 27 LSP tests, 38 VS Code and manifest tests, and packaging.

## Change

- Ran `gauge validate` before local rename fallback edits.
- Rejected local renames when validation reports errors, matching the reference behavior that stops refactoring before edits.
- Passed the extension Gauge CLI into the rename provider activation path.
