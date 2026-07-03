# Spec Dynamic Argument Completion

## Reference Sources

- `references/gauge/api/lang/completionParams.go`
- `references/gauge/api/infoGatherer/specDetails.go`
- `references/gauge-lsp-tests/specifications/codecompletion/parameters.spec`
- `references/gauge-lsp-tests/data/codecomplete/specifications/codecomplete_param.spec`

## Gap

Gauge LSP adds dynamic arguments from spec context, scenario, and teardown steps
to the dynamic parameter completion cache. The VS Code Kotlin implementation
offered spec and scenario data table headers, but did not offer dynamic
arguments already used by other spec steps.

## RED

Command:

```text
node --test --test-name-pattern "spec dynamic step arguments" test/dynamicArgumentCompletion.test.js
```

Result:

```text
pass 0
fail 1
missing dynamic step argument completion from spec steps
```

## GREEN

Command:

```text
node --test --test-name-pattern "spec dynamic step arguments" test/dynamicArgumentCompletion.test.js
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
pass 50
fail 0
```

## Broad Check

Command:

```text
npm run check
```

Result:

```text
test:unit pass 826 fail 0
test:lsp pass 32 fail 0
test:vscode pass 46 fail 0
package succeeded
```
