# Gauge table row terminator parity

Reference:
- `references/gauge/parser/lex.go` recognizes a table row only when the
  trimmed row starts with `|` and ends with `|`.

Behavior:
- Lines that start with `|` but do not end with `|` must not be treated as
  Gauge table rows.

RED:
- Command:
  `node --test test/manifest.test.js test/semanticTokensProvider.test.js test/dynamicArgumentCompletion.test.js test/stepDefinitionProvider.test.js test/codeLensProvider.test.js test/gaugeReference.test.js test/renameProvider.test.js test/stepCodeActions.test.js test/stepDiagnostics.test.js`
- Result: failed, 455 passed and 12 failed.
- Failing coverage:
  - `test/codeLensProvider.test.js` added an unwanted Run in parallel lens for
    `| user`.
  - `test/codeLensProvider.test.js` counted `* Compare` followed by
    `| name` as `Compare <table>`.
  - `test/dynamicArgumentCompletion.test.js` suggested table headers inside
    `| <u`.
  - `test/gaugeReference.test.js` failed to find the plain `Compare`
    reference before `| name`.
  - `test/manifest.test.js` matched Gauge and Concept table row TextMate rules
    for `| name`.
  - `test/renameProvider.test.js` did not update the plain Kotlin Step
    annotation before `| id`.
  - `test/semanticTokensProvider.test.js` emitted table tokens for `| name`.
  - `test/stepCodeActions.test.js` generated a `<table>` stub for `| id`.
  - `test/stepDefinitionProvider.test.js` did not resolve the plain `Compare`
    Step definition before `| name`.
  - `test/stepDiagnostics.test.js` reported an extra undefined step for
    `Confirm order <table>`.
  - `test/stepDiagnostics.test.js` reported a concept table diagnostic for
    `|table`.

GREEN:
- Command:
  `node --test test/manifest.test.js test/semanticTokensProvider.test.js test/dynamicArgumentCompletion.test.js test/stepDefinitionProvider.test.js test/codeLensProvider.test.js test/gaugeReference.test.js test/renameProvider.test.js test/stepCodeActions.test.js test/stepDiagnostics.test.js`
- Result: passed, 467 tests.

Broader check:
- Command: `npm run check`
- Result: passed.
- Coverage: unit 903, LSP 33, VS Code 51, package.
