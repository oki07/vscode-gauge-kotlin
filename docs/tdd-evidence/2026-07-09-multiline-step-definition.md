# Multiline Step Definition

## Reference

- `references/gauge/env/env.go`
- `references/gauge/parser/lex.go`
- `references/gauge/parser/lex_test.go`

When `allow_multiline_step` is true, Gauge merges continuation text into the previous step. Step definition navigation should resolve the merged step from both the first line and continuation lines.

## RED

Command:

```sh
node --test --test-name-pattern "resolves multiline Gauge steps|resolves docstring steps" test/stepDefinitionProvider.test.js
```

Result: failed with 2 passing tests and 1 failing test.

Failing coverage:

- `GaugeStepDefinitionProvider resolves multiline Gauge steps when project allows them`

## GREEN

Command:

```sh
node --test --test-name-pattern "resolves multiline Gauge steps|resolves docstring steps" test/stepDefinitionProvider.test.js
```

Result: passed with 3 passing tests.

Broader targeted command:

```sh
node --test test/stepDefinitionProvider.test.js
```

Result: passed with 35 passing tests.

Implementation:

- Step definition navigation reads `allow_multiline_step` from process environment or project `env/default/default.properties`.
- Navigation normalizes the merged multiline step text for first-line and continuation-line lookups.
