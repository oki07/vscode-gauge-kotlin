# Indented concept hash heading parity

Reference:
- `references/gauge/parser/lex.go` trims each line before classifying Gauge
  headings, so an indented `#` concept heading is still a heading.

Behavior:
- Concept files must treat indented hash headings as real concept headings
  across diagnostics, definition/reference lookup, rename surfaces, semantic
  tokens, folding, symbols, argument completions, argument code actions, code
  lenses, and duplicate checks.

RED:
- Command:
  `node --test test/semanticTokensProvider.test.js test/foldingRangeProvider.test.js test/dynamicArgumentCompletion.test.js test/argumentCodeActions.test.js test/extractConcept.test.js test/stepDiagnostics.test.js test/stepDefinitionProvider.test.js test/documentSymbolProvider.test.js test/codeLensProvider.test.js test/gaugeReference.test.js`
- Result: failed, 13 tests.
- Failing coverage:
  - `test/semanticTokensProvider.test.js` treated an indented concept heading
    as a comment.
  - `test/foldingRangeProvider.test.js`, `test/documentSymbolProvider.test.js`,
    and `test/codeLensProvider.test.js` skipped the indented heading.
  - `test/dynamicArgumentCompletion.test.js` and
    `test/argumentCodeActions.test.js` ignored heading arguments.
  - `test/extractConcept.test.js` allowed duplicate indented concept names.
  - `test/stepDiagnostics.test.js`, `test/stepDefinitionProvider.test.js`, and
    `test/gaugeReference.test.js` did not recognize the indented heading.

GREEN:
- Command:
  `node --test test/semanticTokensProvider.test.js test/foldingRangeProvider.test.js test/dynamicArgumentCompletion.test.js test/argumentCodeActions.test.js test/extractConcept.test.js test/stepDiagnostics.test.js test/stepDefinitionProvider.test.js test/documentSymbolProvider.test.js test/codeLensProvider.test.js test/gaugeReference.test.js`
- Result: passed, 477 tests.

Broader check:
- Command: `npm run check`
- Result: passed.
- Coverage: unit 905, LSP 33, VS Code 51, package.
