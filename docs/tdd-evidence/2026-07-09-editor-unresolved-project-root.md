# Editor Unresolved Project Root Filtering

Reference:
- `vscode-gauge-kotlin/src/argumentCodeActions.js`
- `vscode-gauge-kotlin/src/codeLensProvider.js`
- `vscode-gauge-kotlin/src/foldingRangeProvider.js`
- `vscode-gauge-kotlin/src/stepDiagnostics.js`

Parity behavior:
- Editor providers must not treat a file as a Gauge project file when project root resolution returns no root.
- Document symbols, semantic tokens, and Gauge line comments should follow the same unresolved-root filtering used by the other Gauge editor providers.

RED:
- Command: `node --test --test-name-pattern "project root is unresolved" test/documentSymbolProvider.test.js test/semanticTokensProvider.test.js test/commentCommand.test.js`
- Result: failed because document symbols and semantic tokens were produced for `/workspace/notes/example.spec`, and line comment editing applied Gauge comments instead of delegating.

GREEN:
- Command: `node --test --test-name-pattern "project root is unresolved" test/documentSymbolProvider.test.js test/semanticTokensProvider.test.js test/commentCommand.test.js`
- Result: passed after unresolved roots were treated as non-Gauge files.

Focused:
- Command: `node --test test/documentSymbolProvider.test.js test/semanticTokensProvider.test.js test/commentCommand.test.js`
- Result: passed, 46 tests.
