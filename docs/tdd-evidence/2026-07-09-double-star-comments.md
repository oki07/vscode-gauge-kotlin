# Double-star Gauge comment parity

Reference:
- `references/gauge/parser/lex.go` recognizes a step only when the first
  non-space character is `*` and the next character is not `*`.

Behavior:
- Lines beginning with `**` are Markdown text/comments for Gauge tooling and
  must not be treated as Gauge steps.

RED:
- Command:
  `node --test test/stepDiagnostics.test.js test/stepDefinitionProvider.test.js test/renameProvider.test.js test/argumentCodeActions.test.js test/semanticTokensProvider.test.js test/manifest.test.js test/dynamicArgumentCompletion.test.js test/codeLensProvider.test.js`
- Result: failed.
- Failing coverage:
  - `test/stepDiagnostics.test.js` reported an extra undefined step for
    `** Markdown bullet`.
  - `test/stepDefinitionProvider.test.js` resolved a definition from
    `** Bold comment`.
  - `test/renameProvider.test.js` prepared a rename on `** Bold comment`.
  - `test/argumentCodeActions.test.js` offered a dynamic argument conversion
    on `** Bold "cart"`.
  - `test/semanticTokensProvider.test.js` emitted step tokens instead of a
    comment token for `** Bold comment`.
  - `test/manifest.test.js` matched the Gauge TextMate step rule for
    `** bold comment`.
  - `test/dynamicArgumentCompletion.test.js` offered step completions on
    `** Log`.
  - `test/codeLensProvider.test.js` counted `** Bold comment` as a step
    reference.

GREEN:
- Command:
  `node --test test/stepDiagnostics.test.js test/stepDefinitionProvider.test.js test/renameProvider.test.js test/argumentCodeActions.test.js test/semanticTokensProvider.test.js test/manifest.test.js test/dynamicArgumentCompletion.test.js test/codeLensProvider.test.js`
- Result: passed, 431 tests.

Broader check:
- Command: `npm run check`
- Result: passed.
- Coverage: unit 894, LSP 33, VS Code 51, package.
