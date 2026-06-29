# Scoped Java Static Import Rename

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/rename/CustomRenameHandler.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/findUsages/StepCollector.java`

## RED

- Command: `node --test test/renameProvider.test.js --test-name-pattern "static-imported constant"`
- Result: failed.
- Failure: renaming a Gauge step backed by `@Step(LOGIN)` with `import static fixtures.steps.JavaStepText.LOGIN` also edited an unrelated `other.steps.OtherStepText.LOGIN` constant with the same value.

## GREEN

- Command: `node --test test/renameProvider.test.js --test-name-pattern "static-imported constant"`
- Result: passed, 19 tests.
- Command: `node --test test/renameProvider.test.js`
- Result: passed, 19 tests.
- Command: `node --test test/stepDefinitionProvider.test.js test/stepDiagnostics.test.js test/gaugeReference.test.js test/codeLensProvider.test.js test/dynamicArgumentCompletion.test.js`
- Result: passed, 299 tests.

## Broader Check

- Command: `git diff --check`
- Result: passed.
- Command: `npm run check`
- Result: passed, including 703 unit tests, 27 LSP tests, 36 VS Code and manifest tests, and packaging.

## Change

- Resolved Java constant references in Step annotations through static imports and class imports before applying constant-backed renames.
- Matched Java constant declarations by package and enclosing type scope for fully qualified references.
- Kept simple unqualified fallback behavior for local constant references that do not have an import target.
