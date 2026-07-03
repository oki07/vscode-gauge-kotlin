# Concept TextMate Grammar TDD Evidence

## Scope

Concept files should not use the spec-only TextMate scopes for `tags:` and
`table:` lines. `.cpt` files need a concept-specific language id and grammar
while keeping the same Gauge language configuration and provider coverage.

## Source-only reference context

- `references/intellij-gauge-plugin/resources/META-INF/plugin.xml` registers
  Specification and Concept as separate language/parser/highlighter surfaces.
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_SpecLexer.flex`
  defines `TAGS` and `KEYWORD` for `table:`.
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_ConceptLexer.flex`
  does not define those spec-only keyword tokens.
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/highlight/ConceptSyntaxHighlighter.java`
  highlights concept headings, steps, comments, tables, and arguments only.

## RED

Command:

```sh
node --test --test-name-pattern "core Gauge VS Code surface|Concept TextMate grammar|preserves Gauge editor language configuration" test/manifest.test.js test/extension.test.js
```

Result:

- Passed: 0
- Failed: 3

Failure summary:

- The manifest had no `onLanguage:gauge-concept` activation.
- `.cpt` shared the `gauge` language contribution and grammar.
- Activation registered language configuration only for `gauge`.

## GREEN

Command:

```sh
node --test --test-name-pattern "core Gauge VS Code surface|Concept TextMate grammar|preserves Gauge editor language configuration" test/manifest.test.js test/extension.test.js
```

Result:

- Passed: 3
- Failed: 0

Focused check:

```sh
node --test test/manifest.test.js test/extension.test.js
```

Result:

- Passed: 47
- Failed: 0

## Implementation Notes

- Added `gauge-concept` for `.cpt` files with the same language configuration
  file as `gauge`.
- Added a concept-specific TextMate grammar that omits `tags`, `tableKeyword`,
  spec heading, scenario heading, and teardown repositories.
- Registered Gauge language configuration for both `gauge` and `gauge-concept`.
- Kept existing `**/*.cpt` provider selectors so editor features continue to
  work for concept files.
