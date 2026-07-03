# Step Filter Dynamic Arguments

## Reference Sources

- `references/gauge/api/lang/completionStep.go`
- `references/gauge/api/lang/completionStep_test.go`
- `references/gauge/api/lang/completion_test.go`

## Gap

Gauge LSP builds step completion `filterText` from already typed step
arguments. Static arguments are preserved as quoted values, while dynamic and
special arguments are preserved as angle-bracket values. The VS Code Kotlin
local step completion only preserved already typed static quoted arguments, so
partial steps containing dynamic or special arguments did not filter against
the user-entered value.

## RED

Command:

```text
node --test --test-name-pattern "keeps filled dynamic args" test/dynamicArgumentCompletion.test.js
```

Result:

```text
pass 0
fail 1
filterText kept the placeholder instead of the typed dynamic argument
```

## GREEN

Command:

```text
node --test --test-name-pattern "keeps filled dynamic args" test/dynamicArgumentCompletion.test.js
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
pass 55
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
test:unit pass 831 fail 0
test:lsp pass 32 fail 0
test:vscode pass 46 fail 0
package pass
```
