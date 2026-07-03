# Empty Concept Diagnostics

## Reference Sources

- `references/gauge-lsp-tests/specifications/diagnostics/concept-diagnostics.json`
- `references/gauge-lsp-tests/data/diagnostics/concepts/specifications/concepts/conceptShouldHaveOneStep.cpt`
- `references/gauge/parser/conceptParser.go`

## Gap

Gauge reports concept headings without any step as diagnostics with the message
`Concept should have at least one step`. The VS Code Kotlin local diagnostics
did not validate concept structure beyond blank and undefined step lines.

## RED

Command:

```text
node --test --test-name-pattern "concepts without steps" test/stepDiagnostics.test.js
```

Result:

```text
pass 0
fail 1
empty concept headings produced no diagnostic
```

## GREEN

Command:

```text
node --test --test-name-pattern "concepts without steps" test/stepDiagnostics.test.js
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
pass 210
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
test:unit pass 835 fail 0
test:lsp pass 32 fail 0
test:vscode pass 46 fail 0
package pass
```
