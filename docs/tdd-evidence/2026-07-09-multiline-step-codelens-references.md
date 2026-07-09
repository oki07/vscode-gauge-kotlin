# Multiline Step CodeLens References

## Reference

- `references/gauge/env/env.go`
- `references/gauge/parser/lex.go`
- `references/gauge/parser/lex_test.go`

When `allow_multiline_step` is true, Gauge merges continuation text into the previous step. CodeLens reference counts should count merged multiline step references.

## RED

Command:

```sh
node --test --test-name-pattern "counts multiline step references|counts double-star lines" test/codeLensProvider.test.js
```

Result: failed with 1 passing test and 1 failing test.

Failing coverage:

- `GaugeCodeLensProvider counts multiline step references when project allows them`

Observed failure:

- Expected `1 reference(s)`.
- Actual `0 reference(s)`.

## GREEN

Command:

```sh
node --test --test-name-pattern "counts multiline step references|counts double-star lines" test/codeLensProvider.test.js
```

Result: passed with 2 passing tests.

Broader targeted command:

```sh
node --test test/codeLensProvider.test.js
```

Result: passed with 21 passing tests.

Implementation:

- CodeLens reference counting reads `allow_multiline_step` from process environment or project `env/default/default.properties`.
- Reference counting merges continuation text into Gauge step text before matching Step aliases when multiline steps are enabled.
