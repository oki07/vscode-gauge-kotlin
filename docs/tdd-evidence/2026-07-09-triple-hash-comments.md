# Triple-Hash Comments

## Scope

- Parity target: Gauge spec `###` lines should be comments, not scenario headings.
- Reference: `references/gauge/parser/lex.go` accepts scenario headings only for `##` when the third character is not `#`.
- Reference: `references/gauge/parser/lex_test.go` verifies `### A h3 comment` as a comment.

## RED

Command:

```sh
node --test test/codeLensProvider.test.js test/documentSymbolProvider.test.js test/dynamicArgumentCompletion.test.js test/foldingRangeProvider.test.js test/semanticTokensProvider.test.js test/testController.test.js test/manifest.test.js
```

Result:

- Failed 8 tests.
- Triple-hash lines were still treated as scenarios by CodeLens, document symbols, dynamic argument completion, folding, semantic tokens, Test UI discovery, and the Gauge TextMate grammar.

## GREEN

Command:

```sh
node --test test/codeLensProvider.test.js test/documentSymbolProvider.test.js test/dynamicArgumentCompletion.test.js test/foldingRangeProvider.test.js test/semanticTokensProvider.test.js test/testController.test.js test/manifest.test.js
```

Result:

- Passed 183 tests.

## Broader Checks

Command:

```sh
npm run check
```

Result:

- Passed typecheck, lint, unit tests, LSP tests, VS Code tests, and package.
- Unit: 890 tests passed.
- LSP: 33 tests passed.
- VS Code: 51 tests passed.
