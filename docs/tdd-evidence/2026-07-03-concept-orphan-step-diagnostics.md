# Concept Orphan Step Diagnostics

## Reference Sources

- `references/gauge-lsp-tests/specifications/diagnostics/concept-diagnostics.json`
- `references/gauge-lsp-tests/data/diagnostics/concepts/specifications/concepts/stepNotInConcept.cpt`
- `references/gauge/parser/conceptParser.go`

## Gap

Gauge reports top-level steps before any concept heading in a concept file with
the message `Step is not defined inside a concept heading`. The VS Code Kotlin
local diagnostics only validated blank and undefined step lines.

## RED

Command:

```text
node --test --test-name-pattern "steps outside concept headings" test/stepDiagnostics.test.js
```

Result:

```text
pass 0
fail 1
orphan concept steps produced no structural diagnostic
```

## GREEN

Command:

```text
node --test --test-name-pattern "steps outside concept headings" test/stepDiagnostics.test.js
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
pass 211
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
test:unit pass 836 fail 0
test:lsp pass 32 fail 0
test:vscode pass 46 fail 0
package pass
```
