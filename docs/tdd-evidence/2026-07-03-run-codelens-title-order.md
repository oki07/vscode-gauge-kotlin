# Run CodeLens Title and Order

## Reference

- `references/gauge/api/lang/codeLens.go`
- `references/gauge/api/lang/codeLens_test.go`
- `references/gauge-lsp-tests/specifications/codelens/runLinks/simpleSpec.json`

## RED

Command:

```sh
node --test --test-name-pattern "run and debug lenses" test/codeLensProvider.test.js
```

Result:

- `pass 0`
- `fail 1`
- The provider returned specification lenses before scenario lenses and used `Run Specification` / `Debug Specification` titles.

## GREEN

Command:

```sh
node --test --test-name-pattern "run and debug lenses" test/codeLensProvider.test.js
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

- `pass 14`
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
