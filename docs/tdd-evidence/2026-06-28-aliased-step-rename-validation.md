# Aliased Step rename validation

Parity item: SRC-ED-003

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/rename/CustomRenameHandler.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/rename/GaugeRefactorHandler.java`

Behavior:
- Gauge rename should reject a step whose Kotlin implementation is declared with multiple `@Step` aliases.
- This prevents a partial local rename that edits Gauge usages while leaving the aliased Kotlin annotation unchanged.

RED:
- Command: `node --test --test-name-pattern "aliased Kotlin Step implementations" test/renameProvider.test.js`
- Result: failed 1 of 1. `prepareRename` did not reject the aliased implementation.

GREEN:
- Command: `node --test --test-name-pattern "aliased Kotlin Step implementations" test/renameProvider.test.js`
- Result: passed 1 of 1.

Related:
- Command: `node --test test/renameProvider.test.js test/stepDefinitionProvider.test.js test/extension.test.js`
- Result: passed 46 of 46.

Broad:
- Command: `npm run check`
- Result: passed. Unit 599 of 599, LSP 22 of 22, VS Code 25 of 25, package succeeded.
