# TextMate Table Static Arguments

## Reference

- `references/gauge/parser/convert.go`
- `references/intellij-gauge-plugin/src/specification.bnf`
- `references/intellij-gauge-plugin/src/concept.bnf`

Gauge table body cells only treat `<dynamic>` values specially. Quoted text inside table cells is plain table cell text, not a Gauge static step argument.

## RED

Command:

```sh
node --test test/manifest.test.js
```

Result: failed with 13 passing tests and 2 failing tests.

Failing coverage:

- `Gauge TextMate grammar handles table and argument lexer edge cases`
- `Gauge Concept TextMate grammar ignores escaped argument starts`

## GREEN

Command:

```sh
node --test test/manifest.test.js
```

Result: passed with 15 passing tests.

Implementation:

- Gauge TextMate table argument grammar no longer includes generic step arguments.
- Concept TextMate table argument grammar no longer includes generic step arguments.
