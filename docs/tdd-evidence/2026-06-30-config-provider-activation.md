# Config Provider Activation

## Reference Source

- `references/gauge-vscode/src/extension.ts`
- `references/gauge-vscode/src/config/configProvider.ts`
- `vscode-gauge-kotlin/src/config/configProvider.js`

## RED

- Command: `node --test test/extension.test.js --test-name-pattern "defers CLI"`
- Result: failed, 27 passed and 1 failed.
- Failure: activation did not create `ConfigProvider` when Gauge services were not needed, so `gauge.config.saveRecommended` and Gauge file associations depended on Gauge service startup.

## GREEN

- Command: `node --test test/extension.test.js test/configProvider.test.js --test-name-pattern "activation registers core contributed Gauge commands|defers CLI|ConfigProvider"`
- Result: passed, 33 tests.
- Command: `node --test test/extension.test.js test/configProvider.test.js`
- Result: passed, 33 tests.

## Broader Check

- Command: `npm run check`
- Result: passed, including 721 unit tests, 27 LSP tests, 39 VS Code and manifest tests, and packaging.

## Change

- Moved `ConfigProvider` creation to activation so recommended settings and Gauge file associations are available even when Gauge services are deferred or unavailable.
- Kept service startup gating for CLI, debug, workspace clients, references, stubs, and explorer providers.
- Made configuration inspection defensive for lightweight VS Code API hosts that do not expose `inspect`.
