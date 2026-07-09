# Multiline Step Diagnostics

## Reference

- `references/gauge/skel/skel.go`
- `references/gauge/env/env.go`
- `references/gauge/parser/lex.go`
- `references/gauge/parser/lex_test.go`

Gauge can merge consecutive text lines into the previous step when `allow_multiline_step` is true. Undefined-step diagnostics should resolve the merged step text against Kotlin and Java step implementations.

## RED

Command:

```sh
node --test --test-name-pattern "resolves multiline Gauge steps|reports undefined Gauge steps" test/stepDiagnostics.test.js
```

Result: failed with 2 passing tests and 1 failing test.

Failing coverage:

- `GaugeStepDiagnosticsProvider resolves multiline Gauge steps when project allows them`

## GREEN

Command:

```sh
node --test --test-name-pattern "resolves multiline Gauge steps|reports undefined Gauge steps" test/stepDiagnostics.test.js
```

Result: passed with 3 passing tests.

Broader targeted command:

```sh
node --test test/stepDiagnostics.test.js
```

Result: passed with 221 passing tests.

Implementation:

- Step diagnostics read `allow_multiline_step` from process environment or project `env/default/default.properties`.
- Gauge step extraction merges continuation text into the previous step when multiline steps are enabled.
