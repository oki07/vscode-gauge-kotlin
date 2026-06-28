# Concept Heading Rename

Scope: LNG-B2 includes concept headings in Gauge rename edits when renaming concept usages.

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/StepUtil.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/rename/CustomRenameHandler.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/rename/GaugeRefactorHandler.java`

Target files:
- `src/renameProvider.js`
- `test/renameProvider.test.js`

RED:
- Command: `node --test --test-name-pattern "concept headings" test/renameProvider.test.js`
- Result: failed, 0 passed and 1 failed.
- Failing test: `GaugeRenameProvider renames concept headings when renaming concept usages`.
- Failure: the rename edit replaced the spec usage but did not include the matching `.cpt` concept heading.

GREEN:
- Command: `node --test --test-name-pattern "concept headings" test/renameProvider.test.js`
- Result: passed, 1 test passed.

Related checks:
- Command: `node --test test/renameProvider.test.js test/stepDefinitionProvider.test.js test/gaugeReference.test.js test/stepDiagnostics.test.js`
- Result: passed, 239 tests passed.

Broad check:
- Command: `npm run check`
- Result: passed.
- Unit tests: 589 passed.
- LSP tests: 20 passed.
- VS Code tests: 24 passed.
- Package: passed.
