# Used Step Completion

## Reference Sources

- `references/gauge/api/lang/completionStep.go`
- `references/gauge/api/lang/completion.go`
- `references/gauge/api/lang/completion_test.go`
- `references/gauge-lsp-tests/specifications/codecompletion/steps.spec`
- `references/gauge-lsp-tests/data/steps-codecomplete/specifications/codecomplete_step.spec`

## Gap

Gauge LSP step completion combines concept steps, steps already used in specs or
concepts, and implemented runner steps. The VS Code Kotlin local fallback
completed implemented Kotlin or Java Step aliases and concept headings, but did
not offer used steps when no implementation existed and no LSP client response
was available.

## RED

Command:

```text
node --test --test-name-pattern "used Gauge steps without implementations" test/dynamicArgumentCompletion.test.js
```

Result:

```text
pass 0
fail 1
missing used step completion entries
```

## GREEN

Command:

```text
node --test --test-name-pattern "used Gauge steps without implementations" test/dynamicArgumentCompletion.test.js
```

Result:

```text
pass 1
fail 0
```

## Focused Check

Command:

```text
node --test test/dynamicArgumentCompletion.test.js
```

Result:

```text
pass 51
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
test:unit pass 827 fail 0
test:lsp pass 32 fail 0
test:vscode pass 46 fail 0
package pass
```
