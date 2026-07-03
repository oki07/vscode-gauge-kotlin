# Concept hash scenario heading diagnostics

## Reference behavior

Gauge core treats `##` lines as scenario headings. In concept files, scenario
headings are invalid and produce `Scenario Heading is not allowed in concept file`.

Reference sources:

- `references/gauge/parser/conceptParser.go`
- `references/gauge/parser/lex.go`

## Target behavior

Local concept diagnostics should report top-level `##` lines in `.cpt` files as
scenario heading errors, not as empty concept headings. Other concept validation
paths in `GaugeStepDiagnosticsProvider` should ignore these `##` lines as
concept definitions.

## RED

- Command: `node --test --test-name-pattern "rejects scenario headings in concept files" test/stepDiagnostics.test.js`
- Result: failed.
- Failure summary: `## Hash scenario` produced `Concept should have at least one step` instead of `Scenario Heading is not allowed in concept file`.

## GREEN

- Command: `node --test --test-name-pattern "rejects scenario headings in concept files" test/stepDiagnostics.test.js`
- Result: passed.

## Broader checks

- Command: `node --test test/stepDiagnostics.test.js`
- Result: passed, 216 tests.
- Command: `node --test test/stepDiagnostics.test.js test/argumentCodeActions.test.js test/semanticTokensProvider.test.js test/documentSymbolProvider.test.js test/stepDefinitionProvider.test.js test/dynamicArgumentCompletion.test.js test/gaugeReference.test.js`
- Result: passed, 385 tests.
- Command: `npm run check`
- Result: passed. Unit tests: 848 passed. LSP tests: 32 passed. VS Code tests: 48 passed. Package step passed.
