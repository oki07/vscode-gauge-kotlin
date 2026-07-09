# Tag Continuation Syntax Boundaries

## Scope

Gauge tag continuation highlighting and completions should stop before Gauge
syntax starts. A comma-terminated `tags:` line may continue into plain tag
values, but it should not absorb later `tags:` keywords, headings, steps,
teardown separators, table rows, or Gauge comments.

## Source-only Reference Context

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_SpecLexer.flex`
  returns separate YYINITIAL tokens for headings, `TAGS`, `KEYWORD`,
  `STEP_IDENTIFIER`, `TABLE_BORDER`, `COMMENT`, and `TEARDOWN_IDENTIFIER`.
- `references/intellij-gauge-plugin/src/specification.bnf` models tags,
  comments, keywords, tables, steps, and teardown as separate syntax elements.

## RED

Semantic tokens command:

```sh
node --test --test-name-pattern "stops tag continuations before Gauge syntax starts" test/semanticTokensProvider.test.js
```

Result:

- Passed: 0
- Failed: 1

Failure summary:

- `tags: fast` after `tags: smoke,` was tokenized as only `tagValue`, not as a
  new `tagKeyword` and `tagValue`.

Dynamic completion command:

```sh
node --test --test-name-pattern "DynamicArgumentCompletionProvider stops tag continuations before Gauge syntax starts" test/dynamicArgumentCompletion.test.js
```

Result:

- Passed: 0
- Failed: 1

Failure summary:

- Tag completion items were offered on Gauge syntax start lines such as
  headings, steps, teardown separators, table rows, and disabled Gauge
  comments.

## GREEN

Semantic tokens command:

```sh
node --test --test-name-pattern "stops tag continuations before Gauge syntax starts" test/semanticTokensProvider.test.js
```

Result:

- Passed: 1
- Failed: 0

Dynamic completion command:

```sh
node --test --test-name-pattern "DynamicArgumentCompletionProvider stops tag continuations before Gauge syntax starts" test/dynamicArgumentCompletion.test.js
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

- Semantic token tests passed: 35
- Dynamic argument completion tests passed: 62
- Failed: 0

Broader check:

```sh
npm run check
```

Result:

- Unit tests passed: 877
- LSP tests passed: 33
- VS Code tests passed: 50
- Failed: 0
- Package succeeded

## Implementation Notes

- Semantic tag continuation now yields before Gauge syntax start lines.
- Dynamic tag completion context now stops before Gauge syntax start lines.
- Existing plain multiline tag continuation remains covered.
