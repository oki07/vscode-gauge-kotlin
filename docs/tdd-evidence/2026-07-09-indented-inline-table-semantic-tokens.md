# Indented Inline Table Semantic Tokens

## Scope

Gauge semantic tokens should highlight an indented inline table when the table
belongs to the immediately preceding step. Indented top-level table marker lines
must remain comments.

## Source-only Reference Context

- `references/intellij-gauge-plugin/src/specification.bnf` defines
  `step ::= STEP_IDENTIFIER (arg|STEP)+ (comment)* table?`, so a step can own an
  inline table.
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_SpecLexer.flex`
  moves from a step to the initial state at the line terminator, then accepts
  whitespace before table lines while in table state.
- `references/intellij-gauge-plugin/testdata/specParser/SpecWithDataTable.spec`
  contains `* Step that takes a table` followed by four-space indented table
  rows.
- `references/intellij-gauge-plugin/testdata/specParser/SpecWithDataTable.txt`
  parses those rows as `SpecTableImpl(TABLE)` under the `SpecStepImpl`.

## RED

Command:

```sh
node --test --test-name-pattern "tokenizes indented inline tables after steps" test/semanticTokensProvider.test.js
```

Result:

- Passed: 0
- Failed: 1

Failure summary:

- `GaugeSemanticTokensProvider tokenizes indented inline tables after steps`
  expected a `tableHeader` token on the indented row, but the provider treated
  the table rows as comments.

## GREEN

Command:

```sh
node --test --test-name-pattern "tokenizes indented inline tables after steps" test/semanticTokensProvider.test.js
```

Result:

- Passed: 1
- Failed: 0

Focused check:

```sh
node --test test/semanticTokensProvider.test.js
```

Result:

- Passed: 33
- Failed: 0

Broader check:

```sh
npm run check
```

Result:

- Typecheck passed.
- Lint passed.
- Unit tests passed: 870
- LSP tests passed: 33
- VS Code extension tests passed: 50
- Failed: 0
- Package completed.

## Implementation Notes

- `semanticTokensProvider` now recognizes an indented table block only when the
  block starts immediately after a step line.
- Normal top-level table blocks still require the first table row to start at
  column zero.
- The existing indented top-level table comment behavior remains covered by the
  adjacent regression test.
