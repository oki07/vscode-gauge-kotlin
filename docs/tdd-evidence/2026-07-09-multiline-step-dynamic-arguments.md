# Multiline Step Dynamic Arguments

## Reference

- `references/gauge/env/env.go`
- `references/gauge/parser/lex.go`
- `references/gauge/parser/lex_test.go`

When `allow_multiline_step` is true, Gauge merges continuation text into the previous step. Dynamic argument completion should collect arguments from merged multiline step text.

## RED

Command:

```sh
node --test --test-name-pattern "multiline spec dynamic arguments|spec dynamic step arguments" test/dynamicArgumentCompletion.test.js
```

Result: failed with 1 passing test and 1 failing test.

Failing coverage:

- `GaugeDynamicArgumentCompletionProvider suggests multiline spec dynamic arguments when project allows them`

## GREEN

Command:

```sh
node --test --test-name-pattern "multiline spec dynamic arguments|spec dynamic step arguments" test/dynamicArgumentCompletion.test.js
```

Result: passed with 2 passing tests.

Broader targeted command:

```sh
node --test test/dynamicArgumentCompletion.test.js
```

Result: passed with 70 passing tests.

Implementation:

- Dynamic argument completion reads `allow_multiline_step` from process environment or project `env/default/default.properties`.
- Spec dynamic argument scanning includes continuation lines in merged multiline step text when enabled.
