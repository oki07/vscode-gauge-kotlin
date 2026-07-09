# Multiline Step Reference Provider

## Reference

- `references/gauge/env/env.go`
- `references/gauge/parser/lex.go`
- `references/gauge/parser/lex_test.go`

When `allow_multiline_step` is true, Gauge merges continuation text into the previous step. The reference provider should use the merged step text when resolving local references and when the cursor is on a continuation line.

## RED

Command:

```sh
node --test --test-name-pattern "multiline local Gauge references|multiline Gauge step cursor|local references from Gauge step cursor without LSP|local references for Kotlin Step aliases" test/gaugeReference.test.js
```

Result: failed with 2 passing tests and 2 failing tests.

Failing coverage:

- `ReferenceProvider matches multiline local Gauge references for Kotlin Step aliases`
- `ReferenceProvider provides local references from multiline Gauge step cursor without LSP`

Observed failures:

- Kotlin Step alias references returned no locations for a multiline Gauge step.
- Cursor references from a multiline continuation line returned no locations.

## GREEN

Command:

```sh
node --test --test-name-pattern "multiline local Gauge references|multiline Gauge step cursor|local references from Gauge step cursor without LSP|local references for Kotlin Step aliases" test/gaugeReference.test.js
```

Result: passed with 4 passing tests.

Broader targeted commands:

```sh
node --test test/gaugeReference.test.js
node --test test/stepDefinitionProvider.test.js
```

Result: `test/gaugeReference.test.js` passed with 32 passing tests. `test/stepDefinitionProvider.test.js` passed with 35 passing tests.

Implementation:

- The reference provider reads `allow_multiline_step` from process environment or project `env/default/default.properties`.
- Local Gauge reference scanning merges continuation text into the previous step when multiline steps are enabled.
- Cursor step lookup passes the multiline option through `stepTextAt`, including documents that only expose `getText()`.
