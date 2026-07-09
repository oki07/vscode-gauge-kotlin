# TextMate Legacy Underline Whitespace

Reference:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_SpecLexer.flex`

Behavior:
- Legacy specification underline headings match `=+` only.
- Legacy scenario underline headings match `-+` only.
- Whitespace around the underline marker is not part of the lexer heading token.

RED:
- Command: `node --test test/manifest.test.js`
- Result: failed at `Gauge TextMate grammar follows Gauge lexer line starts and keywords`.
- Failure: the TextMate spec underline pattern matched ` = `.

GREEN:
- Command: `node --test test/manifest.test.js`
- Result: passed 14 tests.

Implementation:
- Tightened Gauge TextMate legacy underline patterns to `^=+$` and `^-+$`.
