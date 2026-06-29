# Java Constant Backed Step Rename

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/rename/CustomRenameHandler.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/findUsages/StepCollector.java`

## RED

- Command: `node --test test/renameProvider.test.js --test-name-pattern "Java constants"`
- Result: failed.
- Failure: renaming a Gauge step updated the spec usage but did not update the Java `static final String` literal backing `@Step(JavaStepText.LOGIN)`.
- Failure: `prepareRename` returned no target when invoked on a Java constant reference used in `@Step(JavaStepText.LOGIN)`.

## GREEN

- Command: `node --test test/renameProvider.test.js --test-name-pattern "Java constants"`
- Result: passed, 18 tests.
- Command: `node --test test/renameProvider.test.js`
- Result: passed, 18 tests.
- Command: `node --test test/stepDefinitionProvider.test.js test/stepDiagnostics.test.js test/gaugeReference.test.js test/codeLensProvider.test.js test/dynamicArgumentCompletion.test.js`
- Result: passed, 299 tests.

## Broader Check

- Command: `git diff --check`
- Result: passed.
- Command: `npm run check`
- Result: passed, including 702 unit tests, 27 LSP tests, 36 VS Code and manifest tests, and packaging.

## Change

- Added Java `static final String` literal range lookup for constant-backed Step renames.
- Enabled `prepareRename` on Java constant-backed `@Step` references.
- Kept Kotlin string template escaping out of Java backing constant replacements.
