# Bare Step Marker Completion Space

## Reference Sources

- `references/gauge/api/lang/completionStep.go`
- `references/gauge/api/lang/completionStep_test.go`

## Gap

Gauge LSP prepends a space to step completion text when completion starts after
a bare `*` marker without following whitespace. The VS Code Kotlin local step
completion replaced text after the marker with the raw step text, producing
`*Step text` instead of `* Step text` when a user completed from `*Log`.

## RED

Command:

```text
node --test --test-name-pattern "inserts a space after bare step markers" test/dynamicArgumentCompletion.test.js
```

Result:

```text
pass 0
fail 1
insertText did not include the leading space after a bare step marker
```

## GREEN

Command:

```text
node --test --test-name-pattern "inserts a space after bare step markers" test/dynamicArgumentCompletion.test.js
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
pass 56
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
test:unit pass 832 fail 0
test:lsp pass 32 fail 0
test:vscode pass 46 fail 0
package pass
```
