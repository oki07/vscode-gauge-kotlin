# Table Diagnostics Without Closing Pipe

Reference:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_SpecLexer.flex`
- `references/gauge-vscode/src/semanticTokensProvider.ts`

Behavior:
- Concept table diagnostics recognize table rows from a leading `|`.
- A closing `|` is not required for table-related diagnostics or `<table>` step identity.

RED:
- Command: `node --test test/stepDiagnostics.test.js`
- Result: failed at `GaugeStepDiagnosticsProvider reports concept tables without closing pipes outside steps`.
- Failure: no diagnostic was reported for a standalone `|table` row in a concept file.

GREEN:
- Command: `node --test test/stepDiagnostics.test.js`
- Result: passed 220 tests.

Implementation:
- Relaxed the diagnostics table-line predicate to use leading-pipe recognition.
- Updated undefined-step expectations where a step followed by `| id` now has `<table>` identity.
