# Constant Backed Step Rename

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/rename/CustomRenameHandler.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/findUsages/StepCollector.java`

## RED

- Command: `node --test test/renameProvider.test.js --test-name-pattern "Kotlin constants backing Step annotations"`
- Result: failed.
- Failure: renaming a Gauge step updated the spec usage but did not update the Kotlin `const val` backing `@Step(StepText.LOGIN)`.
- Command: `node --test test/renameProvider.test.js --test-name-pattern "constant-backed Step annotations"`
- Result: failed.
- Failure: `prepareRename` returned no target when invoked on a Kotlin `@Step(StepText.LOGIN)` constant reference.

## GREEN

- Command: `node --test test/renameProvider.test.js --test-name-pattern "constant-backed Step annotations|Kotlin constants backing Step annotations"`
- Result: passed, 16 tests.
- Command: `node --test test/renameProvider.test.js`
- Result: passed, 16 tests.
- Command: `node --test test/stepDiagnostics.test.js test/stepDefinitionProvider.test.js`
- Result: passed, 224 tests.
- Command: `node --test test/gaugeReference.test.js test/codeLensProvider.test.js`
- Result: passed, 31 tests.

## Broader Check

- Command: `git diff --check`
- Result: passed.
- Command: `npm run check`
- Result: passed, including 697 unit tests, 27 LSP tests, 36 VS Code and manifest tests, and packaging.

## Change

- Added rename support for Kotlin `const val` literals backing single-alias `@Step(CONSTANT)` annotations.
- Added `prepareRename` support when the cursor is on a constant-backed Kotlin `@Step` reference.
- Passed all implementation documents into rename-time constant collection so Java and Kotlin constants are visible consistently.
