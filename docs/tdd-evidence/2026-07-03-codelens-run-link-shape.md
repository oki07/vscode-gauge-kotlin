# CodeLens Run Link Shape

## Reference

- `references/gauge-lsp-tests/specifications/codelens/runLinks.spec`
- `references/gauge-lsp-tests/specifications/codelens/runLinks/simpleSpec.json`
- `references/gauge-lsp-tests/specifications/codelens/runLinks/withTestCases.json`

## RED

Command:

```sh
node --test --test-name-pattern "reference run link command arguments and ranges" test/codeLensProvider.test.js
```

Result:

- `pass 0`
- `fail 1`
- Run/debug CodeLens commands included a second flags argument.
- Run/debug CodeLens ranges covered the Gauge heading text instead of the reference title-width run-link ranges.

## GREEN

Command:

```sh
node --test --test-name-pattern "reference run link command arguments and ranges" test/codeLensProvider.test.js
```

Result:

- `pass 1`
- `fail 0`

## Focused Check

Command:

```sh
node --test test/codeLensProvider.test.js
```

Result:

- `pass 15`
- `fail 0`

Command:

```sh
node --test test/codeLensProvider.test.js test/execution/executor.test.js test/execution/runArgs.test.js test/extension.test.js
```

Result:

- `pass 136`
- `fail 0`

## Broad Check

Command:

```sh
npm run check
```

Result:

- `test:unit`: `pass 851`, `fail 0`
- `test:lsp`: `pass 32`, `fail 0`
- `test:vscode`: `pass 48`, `fail 0`
- `package`: passed

## Change

- Matched Gauge LSP run-link CodeLens command arguments by passing only the execution target.
- Matched Gauge LSP run-link ranges by using the command title width for each run, debug, and parallel CodeLens.
- Kept Test UI machine-readable flags isolated to Test UI execution paths instead of editor CodeLens commands.
