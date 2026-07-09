# Multiline Step Code Actions

## Reference

- `references/gauge/env/env.go`
- `references/gauge/parser/lex.go`
- `references/gauge/parser/lex_test.go`
- `references/gauge/api/lang/codeAction.go`

When `allow_multiline_step` is true, Gauge merges continuation text into the previous step. Undefined-step code actions should use the merged step text for generated Step stubs and concept creation.

## RED

Command:

```sh
node --test --test-name-pattern "multiline Gauge steps|step implementation quick fix" test/stepCodeActions.test.js
```

Result: failed with 2 passing tests and 1 failing test.

Failing coverage:

- `GaugeStepCodeActionProvider creates fixes for multiline Gauge steps when project allows them`

Observed failure:

- Expected generated stub for `Pay with card <amount>`.
- Actual generated stub used only `Pay with`.

## GREEN

Command:

```sh
node --test --test-name-pattern "multiline Gauge steps|step implementation quick fix" test/stepCodeActions.test.js
```

Result: passed with 3 passing tests.

Broader targeted commands:

```sh
node --test test/stepCodeActions.test.js
node --test test/stepDefinitionProvider.test.js
```

Result: `test/stepCodeActions.test.js` passed with 17 passing tests. `test/stepDefinitionProvider.test.js` passed with 35 passing tests.

Implementation:

- Step code actions read `allow_multiline_step` from process environment or project `env/default/default.properties`.
- Generated Kotlin and Java Step stubs use merged multiline step text when enabled.
- Generated concept names use merged multiline step text and preserve parameter replacement.
