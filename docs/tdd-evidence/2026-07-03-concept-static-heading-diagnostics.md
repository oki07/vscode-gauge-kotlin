# Concept Static Heading Diagnostics

## Reference Sources

- `references/gauge-lsp-tests/specifications/diagnostics/concept-diagnostics.json`
- `references/gauge-lsp-tests/data/diagnostics/concepts/specifications/concepts/headingToHaveOnlyDynamicParams.cpt`
- `references/gauge/parser/conceptParser.go`

## Gap

Gauge reports static arguments in concept headings with the message
`Concept heading can have only Dynamic Parameters`. The VS Code Kotlin local
diagnostics accepted static concept heading arguments.

## RED

Command:

```text
node --test --test-name-pattern "static arguments in concept headings" test/stepDiagnostics.test.js
```

Result:

```text
pass 0
fail 1
static concept heading arguments produced no diagnostic
```

## GREEN

Command:

```text
node --test --test-name-pattern "static arguments in concept headings" test/stepDiagnostics.test.js
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
pass 213
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
test:unit pass 838 fail 0
test:lsp pass 32 fail 0
test:vscode pass 46 fail 0
package pass
```
