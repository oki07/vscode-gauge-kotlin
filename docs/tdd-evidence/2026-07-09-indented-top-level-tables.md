# Indented Top-Level Tables

## Reference

- `references/gauge/parser/lex.go`
- `references/gauge-vscode/syntaxes/markdown.tmLanguage`

## RED

Command:

```sh
node --test test/semanticTokensProvider.test.js test/dynamicArgumentCompletion.test.js
```

Result: failed with 103 passing tests and 3 failing tests.

Failing coverage:

- `GaugeDynamicArgumentCompletionProvider suggests indented top-level table headers`
- `GaugeDynamicArgumentCompletionProvider suggests standalone indented table body arguments`
- `GaugeSemanticTokensProvider tokenizes indented top-level table markers`

## GREEN

Command:

```sh
node --test test/semanticTokensProvider.test.js test/dynamicArgumentCompletion.test.js
```

Result: passed with 106 passing tests.

Implementation:

- Semantic tokens now use the indented table block recognizer for Gauge table tokenization.
- Dynamic argument completion now treats indented table blocks as completion contexts.
- Spec and scenario data table header extraction now accepts indented table headers.
