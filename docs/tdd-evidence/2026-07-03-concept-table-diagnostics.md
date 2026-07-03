# Concept Table Placement Diagnostics

## Reference

- `references/gauge-lsp-tests/specifications/diagnostics/concept-diagnostics.json`
- `references/gauge-lsp-tests/data/diagnostics/concepts/specifications/concepts/tableDoesNotBelongToAnyStep.cpt`
- `references/gauge/parser/conceptParser.go`

## RED

Command:

```sh
node --test --test-name-pattern "concept tables outside steps" test/stepDiagnostics.test.js
```

Result:

- `pass 0`
- `fail 1`
- The provider returned no diagnostics for a top-level table before any concept step.

## GREEN

Command:

```sh
node --test --test-name-pattern "concept tables outside steps" test/stepDiagnostics.test.js
```

Result:

- `pass 1`
- `fail 0`

## Focused Check

Command:

```sh
node --test test/stepDiagnostics.test.js
```

Result:

- `pass 214`
- `fail 0`

## Broad Check

Command:

```sh
npm run check
```

Result:

- `test:unit`: `pass 839`, `fail 0`
- `test:lsp`: `pass 32`, `fail 0`
- `test:vscode`: `pass 46`, `fail 0`
- `package`: passed
