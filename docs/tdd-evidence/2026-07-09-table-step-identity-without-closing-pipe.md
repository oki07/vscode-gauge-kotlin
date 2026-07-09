# Table Step Identity Without Closing Pipe

Reference:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_SpecLexer.flex`
- `references/gauge-vscode/src/semanticTokensProvider.ts`

Behavior:
- A table row is recognized from a leading `|` even when it has no closing pipe.
- Steps followed by those rows keep the `<table>` step identity.
- Specification data tables without closing pipes still enable the parallel run lens.

RED:
- Command: `node --test test/codeLensProvider.test.js test/stepDefinitionProvider.test.js test/gaugeReference.test.js test/renameProvider.test.js test/stepCodeActions.test.js`
- Result: failed 6 tests after expectation updates.
- Failures covered CodeLens parallel runs, CodeLens reference counts, ReferenceProvider local references, RenameProvider table identity, StepCodeAction table stubs, and StepDefinitionProvider table-step resolution.

GREEN:
- Command: `node --test test/codeLensProvider.test.js test/stepDefinitionProvider.test.js test/gaugeReference.test.js test/renameProvider.test.js test/stepCodeActions.test.js`
- Result: passed 133 tests.

Implementation:
- Relaxed duplicated inline-table predicates in CodeLens, Reference, Rename, Step CodeAction, and Step Definition providers to use leading-pipe table recognition.
