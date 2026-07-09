# Multiline Step Extract Concept

## Reference

- `references/gauge/env/env.go`
- `references/gauge/parser/lex.go`
- `references/gauge/parser/lex_test.go`
- `references/gauge/conceptExtractor/conceptExtractor.go`

When `allow_multiline_step` is true, Gauge merges continuation text into the previous step. Extract-to-concept should treat the merged multiline step as one extractable step.

## RED

Command:

```sh
node --test --test-name-pattern "multiline Gauge steps|indented Gauge steps" test/extractConcept.test.js
```

Result: failed with 1 passing test and 1 failing test.

Failing coverage:

- `buildExtractSelection accepts multiline Gauge steps when project allows them`

Observed failure:

- Expected one extracted step for `* Pay with card <amount>`.
- Actual extraction returned `undefined` because the continuation line was treated as invalid selected text.

## GREEN

Command:

```sh
node --test --test-name-pattern "multiline Gauge steps|indented Gauge steps" test/extractConcept.test.js
```

Result: passed with 2 passing tests.

Broader targeted commands:

```sh
node --test --test-name-pattern "multiline Gauge steps|selected Gauge steps into an existing concept file|indented Gauge steps" test/extractConcept.test.js
node --test test/extractConcept.test.js
```

Result: targeted command passed with 4 passing tests. `test/extractConcept.test.js` passed with 36 passing tests.

Implementation:

- Extract-to-concept reads `allow_multiline_step` from process environment or project `env/default/default.properties`.
- Selected multiline Gauge step continuations are merged into a single step for concept creation.
- The original multiline source range is replaced by the generated concept usage.
