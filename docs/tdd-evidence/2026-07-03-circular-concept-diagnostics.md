# Circular Concept Diagnostics

## Reference

- `references/gauge-lsp-tests/specifications/diagnostics/circular-references.json`
- `references/gauge-lsp-tests/data/diagnostics/circular-references/specifications/concepts/duplicateConcepts.cpt`
- `references/gauge/parser/conceptParser.go`

## RED

Command:

```sh
node --test --test-name-pattern "circular concept references" test/stepDiagnostics.test.js
```

Result:

- `pass 0`
- `fail 1`
- The provider returned no diagnostics for two concepts that reference each other.

## GREEN

Command:

```sh
node --test --test-name-pattern "circular concept references" test/stepDiagnostics.test.js
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

- `pass 215`
- `fail 0`

## Broad Check

Command:

```sh
npm run check
```

Result:

- `test:unit`: `pass 840`, `fail 0`
- `test:lsp`: `pass 32`, `fail 0`
- `test:vscode`: `pass 46`, `fail 0`
- `package`: passed
