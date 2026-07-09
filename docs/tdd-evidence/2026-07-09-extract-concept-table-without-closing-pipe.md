# Extract Concept Table Without Closing Pipe

Reference:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_SpecLexer.flex`
- `references/gauge-vscode/src/semanticTokensProvider.ts`

Behavior:
- Extract Concept treats rows that start with `|` as inline table rows even without a closing `|`.
- Table parameter formatting still parses and pads those rows like Gauge tables.

RED:
- Command: `node --test test/extractConcept.test.js`
- Result: failed at `ExtractConceptCommandProvider formats table parameters without closing pipes`.
- Failure: the source replacement omitted the table block and left `<table1>` in the concept usage.

GREEN:
- Command: `node --test test/extractConcept.test.js`
- Result: passed 34 tests.

Implementation:
- Relaxed Extract Concept table-line detection to leading-pipe recognition.
- Updated table cell parsing to support rows without a trailing pipe while preserving existing trailing-pipe behavior.
