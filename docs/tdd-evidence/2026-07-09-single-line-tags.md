# Single-Line Tags

Reference:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_SpecLexer.flex`
- `references/gauge-vscode/src/semanticTokensProvider.ts`
- `references/gauge/parser/processor.go`

Behavior:
- Gauge tag declarations are single-line `tags:` entries.
- Lines after a comma-ended tag line are not tag continuations.
- Tag completion is offered only on `tags:` lines.

RED:
- Command: `node --test test/semanticTokensProvider.test.js test/dynamicArgumentCompletion.test.js test/manifest.test.js`
- Result: failed 4 tests.
- Failures covered semantic tag continuation tokens, tag completion on continuation-looking lines, and TextMate tags that stayed open after trailing commas.

GREEN:
- Command: `node --test test/semanticTokensProvider.test.js test/dynamicArgumentCompletion.test.js test/manifest.test.js`
- Result: passed 118 tests.

Implementation:
- Removed semantic token tag continuation state.
- Restricted dynamic tag completion context to actual `tags:` lines.
- Changed the Gauge TextMate tags grammar to end at the current line.
