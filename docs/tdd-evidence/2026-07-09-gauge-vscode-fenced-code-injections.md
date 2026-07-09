# Gauge VS Code Fenced Code Injections

Reference:
- `references/gauge-vscode/syntaxes/markdown.tmLanguage`

Parity behavior:
- Gauge and Concept TextMate grammars should preserve the broad Markdown
  fenced-code language injections from gauge-vscode.
- The Kotlin fenced-code injection remains an extension-specific addition.

RED:
- Command: `node --test test/manifest.test.js`
- Result: failed, 2 tests failed.
- Failures showed missing broad fenced-code injections in both Gauge and
  Concept TextMate grammars.

GREEN:
- Command: `node --test test/manifest.test.js`
- Result: passed, 14 tests.

Broader check:
- Command: `npm run check`
- Result: passed.
- Coverage: typecheck, lint, unit tests, LSP tests, VS Code tests, and package.
- Unit: 906 tests passed.
- LSP: 33 tests passed.
- VS Code: 51 tests passed.
