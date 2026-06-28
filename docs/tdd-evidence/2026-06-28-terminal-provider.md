# Terminal Provider Command

Scope: PCW-C2 registers `gauge.executeIn.terminal` and runs the provided Gauge command text in a new terminal.

Reference source:
- `references/gauge-vscode/src/constants.ts`
- `references/gauge-vscode/src/terminal/terminal.ts`

Target files:
- `src/terminalProvider.js`
- `src/extension.js`
- `test/terminalProvider.test.js`
- `test/extension.test.js`

RED:
- Command: `node --test test/terminalProvider.test.js`
- Result: failed, 0 passed and 1 failed.
- Failing test: `TerminalProvider sends text to a new Gauge terminal and prompts reload`.
- Failure: `src/terminalProvider.js` did not exist.
- Command: `node --test --test-name-pattern "terminal command provider" test/extension.test.js`
- Result: failed, 0 passed and 1 failed.
- Failing test: `activation registers the Gauge terminal command provider`.
- Failure: activation did not register `gauge.executeIn.terminal`.

GREEN:
- Command: `node --test test/terminalProvider.test.js`
- Result: passed, 1 test passed.
- Command: `node --test test/terminalProvider.test.js --test-name-pattern "terminal command provider|TerminalProvider" test/extension.test.js`
- Result: passed, 21 tests passed.

Related checks:
- Command: `node --test test/terminalProvider.test.js test/extension.test.js test/manifest.test.js`
- Result: passed, 26 tests passed.

Broad check:
- Command: `npm run check`
- Result: passed.
- Unit tests: 591 passed.
- LSP tests: 20 passed.
- VS Code tests: 25 passed.
- Package: passed.
