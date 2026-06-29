# Activated Context Spec Explorer Ownership

## Reference Source

- `references/gauge-vscode/src/extension.ts`
- `references/gauge-vscode/src/explorer/specExplorer.ts`

## RED

- Command: `node --test test/extension.test.js --test-name-pattern "activation starts Gauge workspace services for Gauge projects"`
- Result: failed.
- Failure: activation emitted `setContext` for `gauge:activated` with `true` before Spec Explorer readiness.

## GREEN

- Command: `node --test test/extension.test.js --test-name-pattern "activation starts Gauge workspace services for Gauge projects"`
- Result: passed, 25 tests.
- Command: `node --test test/extension.test.js test/specExplorer.test.js`
- Result: passed, 30 tests.

## Broader Check

- Command: `npm run check`
- Result: passed, including 703 unit tests, 27 LSP tests, 36 VS Code and manifest tests, and packaging.

## Change

- Removed the activation-level `gauge:activated` context update from Gauge service startup.
- Kept `SpecNodeProvider` as the owner of the `gauge:activated` context transition after the Gauge LSP client starts.
