# CodeLens Run In Parallel

## Reference Sources

- `references/gauge/api/lang/codeLens.go`
- `references/gauge/api/lang/codeLens_test.go`
- `references/gauge-lsp-tests/specifications/codelens/runLinks.spec`
- `references/gauge-lsp-tests/specifications/codelens/runLinks/withTestCases.json`
- `references/gauge-lsp-tests/specifications/codelens/runLinks/simpleSpec.json`

## Gap

Gauge LSP adds a `Run in parallel` CodeLens on specification headings when the
specification has a specification data table. The VS Code implementation already
registered `gauge.execute.inParallel`, but the CodeLens provider only exposed
run and debug lenses.

## RED

Command:

```text
node --test --test-name-pattern 'run in parallel lens' test/codeLensProvider.test.js
```

Result:

```text
not ok 1 - GaugeCodeLensProvider adds run in parallel lens for specification data tables
# Expected values to be loosely deep-equal:
#   missing Run in parallel CodeLens for gauge.execute.inParallel
```

## GREEN

Command:

```text
node --test --test-name-pattern 'run in parallel lens' test/codeLensProvider.test.js
```

Result:

```text
ok 1 - GaugeCodeLensProvider adds run in parallel lens for specification data tables
# pass 1
# fail 0
```

## Focused Check

Command:

```text
node --test --test-reporter=dot test/codeLensProvider.test.js test/execution/executor.test.js
```

Result:

```text
exit code 0
```

## Broad Check

Command:

```text
npm run check
```

Result:

```text
test:unit pass 817 fail 0
test:lsp pass 32 fail 0
test:vscode pass 46 fail 0
package succeeded
```
