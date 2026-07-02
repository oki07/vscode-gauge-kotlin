# Workspace Symbols

## Reference Source

- `references/gauge/api/lang/capabilities.go`
- `references/gauge/api/lang/symbols.go`
- `references/gauge/api/lang/symbols_test.go`
- `references/gauge-lsp-tests/specifications/documentSymbol/listSymbols.spec`
- `references/gauge-lsp-tests/specifications/documentSymbol/documentSymbols.json`
- `references/gauge-lsp-tests/specifications/documentSymbol/workspaceSymbols.json`

## RED

- Command: `npm test -- --test-name-pattern "workspace symbols|Gauge document symbols" test/documentSymbolProvider.test.js test/extension.test.js`
- Result: failed, 35 passed and 2 failed.
- Failure: `GaugeDocumentSymbolProvider` had no `provideWorkspaceSymbols` function.
- Failure: activation did not register a VS Code workspace symbol provider.

## GREEN

- Command: `node --test --test-name-pattern 'workspace symbols|Gauge document symbols|legacy underline symbols' test/documentSymbolProvider.test.js test/extension.test.js`
- Result: passed, 4 tests.
- Command: `node --test test/documentSymbolProvider.test.js test/extension.test.js`
- Result: passed, 40 tests.

## Broader Check

- Command: `npm run check`
- Result: passed, including 813 unit tests, 32 LSP tests, 46 VS Code and manifest tests, and packaging.

## Change

- Registered the Gauge document symbol provider as a VS Code workspace symbol provider.
- Added local workspace symbols for Gauge specification and scenario headings.
- Matched Gauge LSP query behavior by returning no workspace symbols for one-character queries.
- Sorted workspace spec symbols before scenario symbols by name.
- Prefixed legacy underline document symbols with `#` or `##` to match Gauge LSP symbol names.
