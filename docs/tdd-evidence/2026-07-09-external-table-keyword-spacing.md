# External Table Keyword Spacing

## Scope

External CSV data table header completions should use the same Gauge table
keyword spacing rule as the Gauge syntax sources. `Table:` and `Table :` are
valid table keyword lines. `Table   :` is not a table keyword line.

## Source-only Reference Context

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_SpecLexer.flex`
  defines `Keyword = {WhiteSpace}* table {WhiteSpace}? ":" ...`.
- `src/semanticTokensProvider.js` already tokenizes keyword lines with
  `table[ \t\f]?:`.
- `syntaxes/gauge.tmLanguage.json` already uses the same one-optional-space
  table keyword rule.

## RED

Command:

```sh
node --test --test-name-pattern "requires Gauge table keyword spacing" test/dynamicArgumentCompletion.test.js
```

Result:

- Passed: 0
- Failed: 1

Failure summary:

- `GaugeDynamicArgumentCompletionProvider requires Gauge table keyword spacing
  for external CSV headers` returned `one` and `two` for `Table   : ./csv.csv`.

## GREEN

Command:

```sh
node --test --test-name-pattern "requires Gauge table keyword spacing" test/dynamicArgumentCompletion.test.js
```

Result:

- Passed: 1
- Failed: 0

Focused check:

```sh
node --test test/dynamicArgumentCompletion.test.js
```

Result:

- Passed: 59
- Failed: 0

Broader check:

```sh
npm run check
```

Result:

- Typecheck passed.
- Lint passed.
- Unit tests passed: 871
- LSP tests passed: 33
- VS Code extension tests passed: 50
- Failed: 0
- Package completed.

## Implementation Notes

- `externalDataTablePath` now accepts at most one ` `, `\t`, or `\f` between
  `table` and `:`.
- Dynamic argument completion no longer reads external CSV headers from
  syntactically invalid `Table   :` lines.
