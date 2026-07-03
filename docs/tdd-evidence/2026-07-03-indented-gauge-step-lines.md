# Indented Gauge Step Lines

## Reference

- `references/gauge/parser/lex.go`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/annotator/StepAnnotator.java`
- `references/gauge/api/lang/completion.go`
- `references/gauge/api/lang/completionStep.go`

## RED

Command:

```sh
node --test --test-name-pattern "blank Gauge steps|undefined Gauge steps|undefined concept steps|indented Gauge steps|indented Gauge step arguments|indented Gauge step lines" test/stepDiagnostics.test.js test/stepCodeActions.test.js test/dynamicArgumentCompletion.test.js
```

Result:

- `pass 1`
- `fail 6`
- Diagnostics ignored indented blank and undefined steps.
- Code actions returned no fix for indented steps.
- Completion returned no argument or step-alias items for indented steps.

## GREEN

Command:

```sh
node --test --test-name-pattern "blank Gauge steps|undefined Gauge steps|undefined concept steps|indented Gauge steps|indented Gauge step arguments|indented Gauge step lines" test/stepDiagnostics.test.js test/stepCodeActions.test.js test/dynamicArgumentCompletion.test.js
```

Result:

- `pass 7`
- `fail 0`

## Focused Check

Command:

```sh
node --test test/stepDiagnostics.test.js test/stepCodeActions.test.js test/dynamicArgumentCompletion.test.js
```

Result:

- `pass 285`
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
