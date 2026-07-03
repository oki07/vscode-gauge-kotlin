# LSP Argument Completion Merge

## Reference Sources

- `references/gauge-vscode/src/gaugeWorkspace.ts`
- `references/gauge/api/lang/capabilities.go`
- `references/gauge/api/lang/completion.go`
- `references/gauge/api/lang/completionParams.go`

## Gap

The Gauge VS Code extension delegates completion requests to the Gauge language
server, and Gauge LSP supports parameter completions. The VS Code Kotlin local
fallback merged LSP completions for step and tag contexts, but argument
contexts returned only local labels, so server-provided dynamic or static
parameter completions were unavailable when local extraction missed them.

## RED

Command:

```text
node --test --test-name-pattern "merges Gauge LSP dynamic argument completions" test/dynamicArgumentCompletion.test.js
```

Result:

```text
pass 0
fail 1
completion request was not sent in argument context
```

## GREEN

Command:

```text
node --test --test-name-pattern "merges Gauge LSP dynamic argument completions" test/dynamicArgumentCompletion.test.js
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
pass 54
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
test:unit pass 830 fail 0
test:lsp pass 32 fail 0
test:vscode pass 46 fail 0
package pass
```
