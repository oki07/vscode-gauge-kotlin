# Document Symbol Provider TDD Evidence

## Scope

- Parity item: Gauge document symbols for specification, scenario, and concept headings.
- Reference behavior:
  - Gauge LSP document symbols expose specification and scenario headings as flat namespace symbols.
  - gauge-vscode relies on LSP document symbols and does not add a local fallback provider.
- Reference paths:
  - `references/gauge-lsp-tests/specifications/documentSymbol/documentSymbols.json`
  - `references/gauge-vscode/src/extension.ts`
- Target behavior:
  - VS Code registers a local Gauge document symbol provider for Gauge documents.
  - The provider returns specification, scenario, and concept heading symbols for `.spec`, `.cpt`, and Gauge Markdown documents.

## RED

- Command: `node --test test/documentSymbolProvider.test.js`
- Result: failed with 2 failing tests.
- Failure summary: `../src/documentSymbolProvider` did not exist.
- Command: `node --test --test-name-pattern "document symbols for Gauge documents" test/extension.test.js`
- Result: failed with 1 failing test.
- Failure summary: activation did not register any Gauge document symbol provider.

## Implementation

- Product files:
  - `src/documentSymbolProvider.js`
  - `src/extension.js`
- Summary:
  - Added `GaugeDocumentSymbolProvider` to collect hash and legacy underline Gauge headings as namespace symbols.
  - Registered the provider for Gauge language documents, `.spec` files, Gauge Markdown `.md` files, and `.cpt` files.
  - Kept Markdown document symbols gated by Gauge project resolution.

## GREEN

- Command: `node --test test/documentSymbolProvider.test.js`
- Result: passed with 2 tests.
- Command: `node --test --test-name-pattern "document symbols for Gauge documents" test/extension.test.js`
- Result: passed with 1 selected test.

## Broader Check

- Command: `node --test test/documentSymbolProvider.test.js test/extension.test.js`
- Result: passed with 36 tests.
- Command: `npm run check`
- Result: passed. Unit tests passed 809, LSP tests passed 32, VS Code extension tests passed 46, and packaging completed.
