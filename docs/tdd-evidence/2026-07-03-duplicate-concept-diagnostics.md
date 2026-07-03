# Duplicate concept diagnostics

## Reference behavior

Gauge core reports `Duplicate concept definition found` for both the newly
encountered duplicate concept and the existing concept definition already in the
concept dictionary. The concept dictionary is built across concept files, so
duplicates can come from the same `.cpt` file or from another `.cpt` file in the
same project.

Reference source:

- `references/gauge/parser/conceptParser.go`

## Target behavior

`GaugeStepDiagnosticsProvider` reports duplicate concept diagnostics for every
duplicate concept heading that belongs to the active concept document. Duplicate
detection uses all concept documents in the same Gauge project, then filters the
result back to the active document for the diagnostics collection update.

## RED

- Command: `node --test --test-name-pattern "duplicate concept definitions" test/stepDiagnostics.test.js`
- Result: failed.
- Failure summary:
  - Same-file duplicate concepts returned one diagnostic instead of two.
  - Cross-file duplicate concepts returned no diagnostic for the active concept document.

## GREEN

- Command: `node --test --test-name-pattern "duplicate concept definitions" test/stepDiagnostics.test.js`
- Result: passed, 2 tests.

## Broader checks

- Command: `node --test test/stepDiagnostics.test.js`
- Result: passed, 216 tests.
- Command: `npm run check`
- Result: passed. Unit tests: 848 passed. LSP tests: 32 passed. VS Code tests: 48 passed. Package step passed.
