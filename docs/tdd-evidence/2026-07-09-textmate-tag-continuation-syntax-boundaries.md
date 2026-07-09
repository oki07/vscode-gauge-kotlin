# TextMate Tag Continuation Syntax Boundaries

## Scope

Gauge TextMate tag highlighting should stop before Gauge syntax starts. A
comma-terminated `tags:` line may continue into plain tag values, but the
TextMate tag region should yield before headings, steps, table keywords, tag
keywords, table rows, teardown separators, and disabled Gauge comments.

## Source-only Reference Context

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_SpecLexer.flex`
  returns separate `YYINITIAL` tokens for headings, `TAGS`, `KEYWORD`,
  `STEP_IDENTIFIER`, `TABLE_BORDER`, `COMMENT`, and `TEARDOWN_IDENTIFIER`.
- `references/intellij-gauge-plugin/src/specification.bnf` models tags and the
  later Gauge syntax starts as separate elements.

## RED

Command:

```sh
node --test --test-name-pattern "Gauge TextMate grammar stops trailing-comma tag continuations before Gauge syntax starts" test/manifest.test.js
```

Result:

- Passed: 0
- Failed: 1

Failure summary:

- The tag end pattern matched at the end of `# Next specification`, so the
  boundary line could still be consumed by the tag region before the region
  ended.

## GREEN

Targeted command:

```sh
node --test --test-name-pattern "Gauge TextMate grammar stops trailing-comma tag continuations before Gauge syntax starts" test/manifest.test.js
```

Result:

- Passed: 1
- Failed: 0

Focused check:

```sh
node --test test/manifest.test.js
```

Result:

- Manifest tests passed: 14
- Failed: 0

Broader check:

```sh
npm run check
```

Result:

- Unit tests passed: 880
- LSP tests passed: 33
- VS Code tests passed: 51
- Failed: 0
- Package succeeded

## Implementation Notes

- The Gauge TextMate `tags` region now ends at the start of explicit Gauge
  syntax start lines.
- Plain trailing-comma tag continuation behavior remains covered by existing
  grammar tests.
