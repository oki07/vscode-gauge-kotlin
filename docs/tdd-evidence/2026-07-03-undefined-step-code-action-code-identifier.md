# Undefined Step Code Action Diagnostic Code Identifier

## Reference

- `references/gauge-lsp-tests/specifications/codeaction/undefinedStep.json`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/annotator/CreateStepImplFix.java`

## RED

Command:

```sh
node --test --test-name-pattern "undefined-step diagnostic code identifiers" test/stepCodeActions.test.js
```

Result:

- `pass 0`
- `fail 1`
- The quick fix used `gauge.undefinedStep` as the generated implementation body.

## GREEN

Command:

```sh
node --test --test-name-pattern "undefined-step diagnostic code identifiers" test/stepCodeActions.test.js
```

Result:

- `pass 1`
- `fail 0`

## Focused Check

Command:

```sh
node --test test/stepCodeActions.test.js
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
