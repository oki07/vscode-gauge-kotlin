# Markdown LSP Workspace

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileTypeFactory.java`
- `references/gauge-vscode/src/execution/gaugeExecutor.ts`
- `references/gauge-vscode/src/explorer/specExplorer.ts`

## RED

- Command: `node --test test/gaugeWorkspace.test.js --test-name-pattern "active Markdown Gauge specification"`
- Result: failed, 21 passed and 1 failed.
- Failure reason: `GaugeWorkspace` only considered active `gauge`, `kotlin`, or `java` documents for startup and did not start an LSP client for an active Markdown `.md` Gauge specification.

## GREEN

- Command: `node --test test/gaugeWorkspace.test.js`
- Result: passed, 22 tests.

## Broader Checks

- Command: `npm run check`
- Result: passed, 678 unit tests, 26 LSP tests, 36 VS Code surface tests, and VSIX packaging.

## Change

- Active Markdown `.md` Gauge specifications can start the Gauge LSP workspace client.
- Gauge LSP client document selectors now include project-scoped Markdown `.md` specifications.
