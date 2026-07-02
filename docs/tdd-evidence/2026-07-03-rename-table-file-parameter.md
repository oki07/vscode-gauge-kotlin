# Rename Table File Parameter

## Reference Sources

- `references/gauge-lsp-tests/specifications/rename/withCsvParameter/java_impl.json`
- `references/gauge-lsp-tests/specifications/rename/withCsvParameter/javascript_impl.json`
- `references/gauge-lsp-tests/specifications/rename/withCsvParameter/dotnet_impl.json`

## Gap

Gauge rename keeps `<table:validTable.csv>` in the spec text, but normalizes the
implementation annotation parameter to `<table1>` and adds an implementation
method parameter. The VS Code Kotlin implementation previously wrote
`<table:validTable.csv>` into the Kotlin Step annotation and did not add a
Kotlin function parameter.

## RED

Command:

```text
node --test --test-name-pattern "normalizes table file parameters" test/renameProvider.test.js
```

Result:

```text
fail 1
actual Kotlin annotation replacement: a basic step <table:validTable.csv>
missing Kotlin function parameter replacement
```

## GREEN

Command:

```text
node --test --test-name-pattern "normalizes table file parameters" test/renameProvider.test.js
```

Result:

```text
pass 1
fail 0
```

## Focused Check

Command:

```text
node --test test/renameProvider.test.js
```

Result:

```text
pass 27
fail 0
```

## Broad Check

Command:

```text
npm run check
```

Result:

```text
test:unit pass 819 fail 0
test:lsp pass 32 fail 0
test:vscode pass 46 fail 0
package succeeded
```
