# Extract Concept Docstring Blocks

## Reference

- `references/gauge/parser/lex.go`
- `references/gauge/parser/specparser.go`
- `references/gauge/parser/stepParser_test.go`

## RED

Command:

```sh
node --test --test-name-pattern "docstring" test/extractConcept.test.js
```

Result:

- `pass 0`
- `fail 2`
- `buildExtractSelection includes docstring blocks after selected Gauge steps` ended at the selected step line and did not include the following fenced docstring block.
- `ExtractConceptCommandProvider extracts docstring blocks with selected Gauge steps` replaced only the selected step instead of replacing the step plus docstring block.

## GREEN

Command:

```sh
node --test --test-name-pattern "docstring" test/extractConcept.test.js
```

Result:

- `pass 2`
- `fail 0`

## Focused Check

Command:

```sh
node --test test/extractConcept.test.js
```

Result:

- `pass 31`
- `fail 0`

Command:

```sh
node --test test/extractConcept.test.js test/stepDiagnostics.test.js test/stepCodeActions.test.js
```

Result:

- `pass 261`
- `fail 0`

## Broad Check

Command:

```sh
npm run check
```

Result:

- `test:unit`: `pass 850`, `fail 0`
- `test:lsp`: `pass 32`, `fail 0`
- `test:vscode`: `pass 48`, `fail 0`
- `package`: passed

## Change

- Included fenced Gauge docstring blocks when extracting a selected step into a concept.
- Preserved the docstring block in the generated concept body.
- Replaced the source range covering both the step and its docstring block with the extracted concept call.
