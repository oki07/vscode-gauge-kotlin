# Duplicate Concept Diagnostics

## Reference Sources

- `references/gauge-lsp-tests/specifications/diagnostics/duplicate-diagnostics.json`
- `references/gauge-lsp-tests/data/diagnostics/duplicate-concepts/specifications/concepts/duplicateConcepts.cpt`
- `references/gauge/api/lang/diagnostics.go`
- `references/gauge/parser/conceptParser.go`

## Gap

Gauge reports duplicate concept definitions as diagnostics with the message
`Duplicate concept definition found`. The VS Code Kotlin local diagnostics only
reported blank and undefined Gauge steps for spec and concept documents.

## RED

Command:

```text
node --test --test-name-pattern "duplicate concept definitions" test/stepDiagnostics.test.js
```

Result:

```text
pass 0
fail 1
duplicate concept headings produced no diagnostic
```

## GREEN

Command:

```text
node --test --test-name-pattern "duplicate concept definitions" test/stepDiagnostics.test.js
```

Result:

```text
pass 1
fail 0
```

## Focused Check

Command:

```text
node --test test/stepDiagnostics.test.js
```

Result:

```text
pass 209
fail 0
```

## Broad Check

Command:

```text
npm run check
```

Result:

```text
typecheck pass
lint pass
test:unit pass 834 fail 0
test:lsp pass 32 fail 0
test:vscode pass 46 fail 0
package pass
```
