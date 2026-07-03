# External CSV Data Table Completion

## Reference Sources

- `references/gauge/api/lang/completionParams.go`
- `references/gauge/api/infoGatherer/specDetails.go`
- `references/gauge/parser/lex.go`
- `references/gauge/parser/tableParser.go`
- `references/gauge-lsp-tests/specifications/codecompletion/parameters.spec`
- `references/gauge-lsp-tests/data/codecomplete/specifications/codecomplete_param.spec`
- `references/gauge-lsp-tests/data/codecomplete/csv.csv`

## Gap

Gauge LSP resolves `table:` data table references before returning dynamic
parameter completions, so headers from external CSV files are offered in step
dynamic argument positions. The VS Code Kotlin implementation only inspected
inline spec data tables and missed headers from external CSV data tables.

## RED

Command:

```text
node --test --test-name-pattern "external CSV data table headers" test/dynamicArgumentCompletion.test.js
```

Result:

```text
pass 0
fail 1
missing external CSV data table header completions
```

## GREEN

Command:

```text
node --test --test-name-pattern "external CSV data table headers" test/dynamicArgumentCompletion.test.js
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
pass 49
fail 0
```

## Broad Check

Command:

```text
npm run check
```

Result:

```text
test:unit pass 825 fail 0
test:lsp pass 32 fail 0
test:vscode pass 46 fail 0
package succeeded
```
