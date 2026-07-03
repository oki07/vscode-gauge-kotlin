# Step Completion Documentation

## Reference

- `references/gauge/api/lang/completionStep.go`

## RED

Command:

```sh
node --test --test-name-pattern "suggests Kotlin Step aliases on step lines|deduplicates normalized Gauge LSP step completions" test/dynamicArgumentCompletion.test.js
```

Result:

- `pass 0`
- `fail 2`
- Local step completion items had no `documentation` value.

## GREEN

Command:

```sh
node --test --test-name-pattern "suggests Kotlin Step aliases on step lines|deduplicates normalized Gauge LSP step completions" test/dynamicArgumentCompletion.test.js
```

Result:

- `pass 2`
- `fail 0`

## Focused Check

Command:

```sh
node --test test/dynamicArgumentCompletion.test.js
```

Result:

- `pass 56`
- `fail 0`

## Broad Check

Command:

```sh
npm run check
```

Result:

- `test:unit`: `pass 841`, `fail 0`
- `test:lsp`: `pass 32`, `fail 0`
- `test:vscode`: `pass 46`, `fail 0`
- `package`: passed
