# Triple Hash Scenario Heading

Reference:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_SpecLexer.flex`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/folding/SpecFoldingBuilder.java`

Parity behavior:
- IntelliJ Gauge spec lexing treats any line beginning with `##` as a scenario heading, including `###`.
- VS Code folding, document symbols, code lenses, semantic tokens, Test UI discovery, and TextMate grammar should treat `###` as a Gauge scenario heading in spec files.

RED:
- Command: `node --test --test-name-pattern "folds only hash headings accepted by the Gauge lexer" test/foldingRangeProvider.test.js`
- Result: failed because `### Nested scenario syntax` stayed inside the previous `##` fold.

GREEN:
- Command: `node --test --test-name-pattern "folds only hash headings accepted by the Gauge lexer" test/foldingRangeProvider.test.js`
- Result: passed after triple-hash headings were accepted as scenario headings.

Focused:
- Command: `node --test test/foldingRangeProvider.test.js test/documentSymbolProvider.test.js test/codeLensProvider.test.js test/semanticTokensProvider.test.js test/testController.test.js test/manifest.test.js test/dynamicArgumentCompletion.test.js`
- Result: passed, 171 tests.
