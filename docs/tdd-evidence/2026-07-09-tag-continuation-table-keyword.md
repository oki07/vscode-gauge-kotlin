# Tag Continuation Table Keyword Boundary

## Scope

Gauge tag continuation highlighting and completions should stop before a
`table:` keyword line. The table keyword is a separate Gauge syntax element,
not a tag value continued from a previous comma-terminated `tags:` line.

## Source-only Reference Context

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_SpecLexer.flex`
  defines `Tags` and `Keyword` as separate YYINITIAL tokens.
- `references/intellij-gauge-plugin/src/specification.bnf` models `tags` and
  `keyword` as separate syntax elements in `specDetail`.

## RED

Semantic tokens command:

```sh
node --test --test-name-pattern "stops tag continuations before table keyword lines" test/semanticTokensProvider.test.js
```

Result:

- Passed: 0
- Failed: 1

Failure summary:

- The `table: users.csv` line after `tags: smoke,` was tokenized as `tagValue`
  instead of `tableKeyword` and `tableFileValue`.

Dynamic completion command:

```sh
node --test --test-name-pattern "DynamicArgumentCompletionProvider stops tag continuations before table keyword lines" test/dynamicArgumentCompletion.test.js
```

Result:

- Passed: 0
- Failed: 1

Failure summary:

- Tag completions were offered on the `table: users.csv` line and treated the
  table keyword line as a tag value.

## GREEN

Semantic tokens command:

```sh
node --test --test-name-pattern "stops tag continuations before table keyword lines" test/semanticTokensProvider.test.js
```

Result:

- Passed: 1
- Failed: 0

Dynamic completion command:

```sh
node --test --test-name-pattern "DynamicArgumentCompletionProvider stops tag continuations before table keyword lines" test/dynamicArgumentCompletion.test.js
```

Result:

- Passed: 1
- Failed: 0

Focused checks:

```sh
node --test test/semanticTokensProvider.test.js
node --test test/dynamicArgumentCompletion.test.js
```

Result:

- Semantic token tests passed: 34
- Dynamic argument completion tests passed: 61
- Failed: 0

Broader check:

```sh
npm run check
```

Result:

- Typecheck passed.
- Lint passed.
- Unit tests passed: 875
- LSP tests passed: 33
- VS Code extension tests passed: 50
- Failed: 0
- Package completed.

## Implementation Notes

- Semantic token tag continuation now yields to `table:` keyword tokenization.
- Dynamic tag completion context now stops on `table:` keyword lines.
- Existing multiline tag continuation behavior remains covered.
