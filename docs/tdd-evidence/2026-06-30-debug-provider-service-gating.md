# Debug Provider Service Gating

## Reference Source

- `references/gauge-vscode/src/extension.ts`

## RED

- Command: `node --test test/extension.test.js --test-name-pattern "activation defers CLI and debug provider creation when Gauge services are not needed"`
- Result: failed.
- Failure: activation registered the Gauge debug configuration provider even when Gauge services were not needed.

## GREEN

- Command: `node --test test/extension.test.js`
- Result: passed, 25 tests.

## Broader Check

- Command: `npm run check`
- Result: passed, including 703 unit tests, 27 LSP tests, 36 VS Code and manifest tests, and packaging.

## Change

- Moved Gauge debug configuration provider registration into Gauge service startup.
- Kept the provider registered for Gauge projects after install and version checks pass.
- Avoided registering the Gauge debug provider in workspaces where Gauge services are not started.
