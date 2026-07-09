# Table Completion Without Closing Pipe

Reference:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_SpecLexer.flex`
- `references/gauge-vscode/src/semanticTokensProvider.ts`

Behavior:
- Table-cell dynamic argument completion recognizes table rows from a leading `|`.
- A closing `|` is not required to offer table header names.

RED:
- Command: `node --test test/dynamicArgumentCompletion.test.js`
- Result: failed at `GaugeDynamicArgumentCompletionProvider suggests table headers without closing pipes`.
- Failure: no completion items were returned for `| <u`.

GREEN:
- Command: `node --test test/dynamicArgumentCompletion.test.js`
- Result: passed 66 tests.

Implementation:
- Relaxed the dynamic argument completion table-line predicate to use leading-pipe recognition.
