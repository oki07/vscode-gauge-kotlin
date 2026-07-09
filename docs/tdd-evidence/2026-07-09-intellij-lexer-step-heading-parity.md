# IntelliJ Lexer Step Heading Parity

Reference:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_SpecLexer.flex`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_ConceptLexer.flex`
- `references/gauge-vscode/src/semanticTokensProvider.ts`

Parity behavior:
- Gauge spec lines beginning with `###` are scenario headings because the
  IntelliJ spec lexer matches `##` followed by the remaining line text.
- Gauge spec and concept lines beginning with `**` are step lines because the
  IntelliJ lexers consume the first `*` as the step identifier.
- VS Code editor features should apply the same syntax to TextMate grammar,
  semantic tokens, folding, symbols, CodeLens, Test UI discovery, completion,
  definition, rename, references, diagnostics, and argument/code actions.

RED:
- Command:
  `node --test test/manifest.test.js test/semanticTokensProvider.test.js test/foldingRangeProvider.test.js test/documentSymbolProvider.test.js test/codeLensProvider.test.js test/testController.test.js test/dynamicArgumentCompletion.test.js test/renameProvider.test.js test/stepDefinitionProvider.test.js test/argumentCodeActions.test.js test/stepDiagnostics.test.js`
- Result: failed, 14 tests failed.
- Failures showed that `###` still behaved as a comment in scenario-aware
  providers and `**` still behaved as a non-step line in step-aware providers.

GREEN:
- Command:
  `node --test test/manifest.test.js test/semanticTokensProvider.test.js test/foldingRangeProvider.test.js test/documentSymbolProvider.test.js test/codeLensProvider.test.js test/testController.test.js test/dynamicArgumentCompletion.test.js test/renameProvider.test.js test/stepDefinitionProvider.test.js test/argumentCodeActions.test.js test/stepDiagnostics.test.js`
- Result: passed, 495 tests.

Broader check:
- Command: `npm run check`
- Result: passed.
- Coverage: typecheck, lint, unit tests, LSP tests, VS Code tests, and package.
- Unit: 906 tests passed.
- LSP: 33 tests passed.
- VS Code: 51 tests passed.
