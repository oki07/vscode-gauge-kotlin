# Tag Continuation Legacy Heading Boundaries

## Scope

Gauge tag continuation highlighting and completions should stop before legacy
underline headings. A comma-terminated `tags:` line may continue into plain tag
values, but it should not consume a following `Title` plus `=====` or `-----`
heading pair.

## Source-only Reference Context

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_SpecLexer.flex`
  returns `SPEC_HEADING` for text followed by `=` underline and
  `SCENARIO_HEADING` for text followed by `-` underline while in `YYINITIAL`.
- `references/intellij-gauge-plugin/src/specification.bnf` models legacy
  specification and scenario headings separately from `tags`.

## RED

Semantic tokens command:

```sh
node --test --test-name-pattern "stops tag continuations before legacy underline headings" test/semanticTokensProvider.test.js
```

Result:

- Passed: 0
- Failed: 1

Failure summary:

- `Checkout flow` after `tags: smoke,` was tokenized as `tagValue`, not as a
  legacy specification heading.

Dynamic completion command:

```sh
node --test --test-name-pattern "DynamicArgumentCompletionProvider stops tag continuations before legacy underline headings" test/dynamicArgumentCompletion.test.js
```

Result:

- Passed: 0
- Failed: 1

Failure summary:

- Tag completion items were offered on a legacy underline heading title after a
  comma-terminated `tags:` line.

## GREEN

Semantic tokens command:

```sh
node --test --test-name-pattern "stops tag continuations before legacy underline headings" test/semanticTokensProvider.test.js
```

Result:

- Passed: 1
- Failed: 0

Dynamic completion command:

```sh
node --test --test-name-pattern "DynamicArgumentCompletionProvider stops tag continuations before legacy underline headings" test/dynamicArgumentCompletion.test.js
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

- Semantic token tests passed: 36
- Dynamic argument completion tests passed: 63
- Failed: 0

Broader check:

```sh
npm run check
```

Result:

- Unit tests passed: 879
- LSP tests passed: 33
- VS Code tests passed: 50
- Failed: 0
- Package succeeded

## Implementation Notes

- Semantic tag continuation now yields before legacy underline heading title
  lines.
- Dynamic tag completion context now stops before legacy underline heading title
  lines.
