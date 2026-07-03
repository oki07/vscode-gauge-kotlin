# Concept Scenario Heading Diagnostics

## Reference Sources

- `references/gauge-lsp-tests/specifications/diagnostics/concept-diagnostics.json`
- `references/gauge-lsp-tests/data/diagnostics/concepts/specifications/concepts/scenarioHeadingNotAllowed.cpt`
- `references/gauge/parser/conceptParser.go`

## Gap

Gauge reports legacy scenario headings in concept files with the message
`Scenario Heading is not allowed in concept file`. The VS Code Kotlin local
diagnostics did not validate that concept files reject scenario heading syntax.

## RED

Command:

```text
node --test --test-name-pattern "scenario headings in concept files" test/stepDiagnostics.test.js
```

Result:

```text
pass 0
fail 1
legacy scenario headings in concept files produced no diagnostic
```

## GREEN

Command:

```text
node --test --test-name-pattern "scenario headings in concept files" test/stepDiagnostics.test.js
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
pass 212
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
test:unit pass 837 fail 0
test:lsp pass 32 fail 0
test:vscode pass 46 fail 0
package pass
```
