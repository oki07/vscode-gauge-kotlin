# Multi-alias Step references

Parity item: SRC-ED-002

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/findUsages/helper/ReferenceSearchHelper.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/findUsages/ReferenceSearch.java`
- `references/gauge-vscode/src/gaugeReference.ts`

Behavior:
- Find References from a Kotlin Step implementation declaration should include references for every alias declared by the same `@Step` annotation.
- Find References from inside a specific Step alias string should keep the existing single-alias behavior.

RED:
- Command: `node --test --test-name-pattern "every Kotlin Step alias" test/gaugeReference.test.js`
- Result: failed 1 of 1. Only the first alias reference was returned.

GREEN:
- Command: `node --test --test-name-pattern "every Kotlin Step alias" test/gaugeReference.test.js`
- Result: passed 1 of 1.

Related:
- Command: `node --test test/gaugeReference.test.js test/stepDefinitionProvider.test.js test/extension.test.js`
- Result: passed 60 of 60.

Broad:
- Command: `npm run check`
- Result: passed. Unit 597 of 597, LSP 22 of 22, VS Code 25 of 25, package succeeded.
