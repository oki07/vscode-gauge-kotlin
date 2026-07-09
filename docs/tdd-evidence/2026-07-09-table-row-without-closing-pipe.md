# Table Row Without Closing Pipe

Reference:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_SpecLexer.flex`
- `references/gauge-vscode/src/semanticTokensProvider.ts`

Behavior:
- A Gauge table line is recognized from its leading `|`.
- A closing `|` is not required for semantic tokens or TextMate grammar matching.

RED:
- Command: `node --test test/semanticTokensProvider.test.js test/manifest.test.js`
- Result: failed 3 tests.
- Failures:
  - `GaugeSemanticTokensProvider tokenizes table rows without closing pipes`
  - `extension manifest contributes a Concept TextMate grammar`
  - `Gauge TextMate grammar follows Gauge lexer line starts and keywords`

GREEN:
- Command: `node --test test/semanticTokensProvider.test.js test/manifest.test.js`
- Result: passed 52 tests.

Implementation:
- Relaxed table-line detection in `src/semanticTokensProvider.js` to use a leading `|`.
- Relaxed Gauge and Concept TextMate `tableRow` begin patterns to match leading-pipe rows without requiring a later pipe.
