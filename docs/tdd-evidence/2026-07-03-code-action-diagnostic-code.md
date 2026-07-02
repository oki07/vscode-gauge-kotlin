# Code Action Diagnostic Code

## Reference Sources

- `references/gauge/api/lang/codeAction.go`
- `references/gauge/api/lang/codeAction_test.go`
- `references/gauge-lsp-tests/specifications/codeaction/undefinedStep.json`
- `references/gauge-lsp-tests/specifications/codeaction/deleteDefinedStep.json`

## Gap

Gauge LSP creates the step implementation quick fix whenever a diagnostic has a
non-empty `code` value, and passes that code value directly as the
`gauge.generate.step` command argument. The VS Code Kotlin implementation only
accepted diagnostics with the local `Undefined Step` message and regenerated the
stub from the step text. It also returned no step action when the requested
range was not on a parsed step line, even though the reference still returns the
diagnostic-provided step action in that case.

## RED

Command:

```text
node --test test/stepCodeActions.test.js
```

Result:

```text
pass 11
fail 2
missing diagnostic.code based step implementation actions
```

## GREEN

Command:

```text
node --test test/stepCodeActions.test.js
```

Result:

```text
pass 13
fail 0
```

## Focused Check

Command:

```text
node --test test/stepCodeActions.test.js test/argumentCodeActions.test.js
```

Result:

```text
pass 29
fail 0
```

## Broad Check

Command:

```text
npm run check
```

Result:

```text
test:unit pass 824 fail 0
test:lsp pass 32 fail 0
test:vscode pass 46 fail 0
package succeeded
```
