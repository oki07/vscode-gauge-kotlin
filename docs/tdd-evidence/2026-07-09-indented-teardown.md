# Indented Teardown Markers

## Reference

- `references/gauge/parser/lex.go`

The Gauge lexer passes trimmed line text into teardown recognition, so an indented `___` line is still a teardown marker.

## RED

Command:

```sh
node --test test/semanticTokensProvider.test.js test/dynamicArgumentCompletion.test.js test/foldingRangeProvider.test.js test/manifest.test.js
```

Result: failed with 130 passing tests and 5 failing tests.

Failing coverage:

- `GaugeDynamicArgumentCompletionProvider excludes static arguments after indented teardown markers`
- `GaugeFoldingRangeProvider folds indented teardown markers`
- `Gauge TextMate grammar follows Gauge lexer line starts and keywords`
- `Gauge TextMate grammar handles table and argument lexer edge cases`
- `GaugeSemanticTokensProvider tokenizes teardown separators`

## GREEN

Command:

```sh
node --test test/semanticTokensProvider.test.js test/dynamicArgumentCompletion.test.js test/foldingRangeProvider.test.js test/manifest.test.js
```

Result: passed with 135 passing tests.

Implementation:

- Teardown recognition now trims leading whitespace in semantic tokens, folding, and static argument collection.
- Gauge TextMate teardown matching now accepts leading whitespace.
