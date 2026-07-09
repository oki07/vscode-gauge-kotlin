# TextMate Top-Level Arguments

## Scope

- Reference source: `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_SpecLexer.flex`
- Reference source: `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_ConceptLexer.flex`
- Target source: `syntaxes/gauge.tmLanguage.json`
- Target source: `syntaxes/gauge-concept.tmLanguage.json`
- Test source: `test/manifest.test.js`

## RED

Command:

```sh
node --test test/manifest.test.js
```

Result:

- Failed 2 tests.
- `extension manifest contributes a Concept TextMate grammar`
- `Gauge TextMate grammar handles table and argument lexer edge cases`

Reason:

- Plain comment lines containing `<arg>` or `"arg"` matched the top-level `#arguments` pattern before fallback comments.

## GREEN

Command:

```sh
node --test test/manifest.test.js
```

Result:

- Passed 15 tests.

Implementation:

- Removed top-level `#arguments` includes from Gauge and Concept grammars.
- Kept argument patterns reachable from step, heading, and table grammar contexts.
