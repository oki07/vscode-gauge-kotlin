# Incomplete Argument Completion

## Reference Sources

- `references/gauge/api/lang/completionParams.go`
- `references/gauge/api/lang/completionParams_test.go`
- `references/gauge/api/lang/completion_test.go`

## Gap

Gauge LSP parameter completion returns dynamic and static argument items with
`detail` set to the argument type and appends the missing closing delimiter to
`filterText` and the text edit. The VS Code Kotlin local fallback returned
plain labels for incomplete `<...` and `"...` argument contexts, so accepting
the completion did not close the argument and the item did not expose the
argument type.

## RED

Command:

```text
node --test --test-name-pattern "closes incomplete" test/dynamicArgumentCompletion.test.js
```

Result:

```text
pass 0
fail 2
missing detail and closing delimiter completion text
```

## GREEN

Command:

```text
node --test --test-name-pattern "closes incomplete" test/dynamicArgumentCompletion.test.js
```

Result:

```text
pass 2
fail 0
```

## Focused Check

Command:

```text
node --test test/dynamicArgumentCompletion.test.js
```

Result:

```text
pass 53
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
test:unit pass 829 fail 0
test:lsp pass 32 fail 0
test:vscode pass 46 fail 0
package pass
```
