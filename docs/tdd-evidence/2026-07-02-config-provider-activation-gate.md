# Config Provider Activation Gate TDD Evidence

## Scope

- Parity item: `gauge-vscode-file-source-references-gauge-vscode-src-extension-ts-references-gauge-vscode-src-extension-ts`
- Reference behavior: the official Gauge VS Code activation registers `ProjectInitializer`, then returns before creating `ConfigProvider` when no active Gauge document or Gauge project is present.
- Reference path: `references/gauge-vscode/src/extension.ts`
- Target behavior: avoid Gauge configuration side effects in non-Gauge workspaces while still creating `ConfigProvider` after Gauge services start.

## RED

- Test path: `test/extension.test.js`
- Command: `node --test test/extension.test.js --test-name-pattern "core contributed Gauge commands|defers CLI and debug provider creation|config provider only after Gauge services"`
- Result: failed with 2 failing tests.
- Failure summary: activation still registered `gauge.config.saveRecommended` and created `ConfigProvider` before the Gauge-service gate in a non-Gauge workspace.

## Implementation

- Production file: `src/extension.js`
- Summary:
  - Removed eager `ConfigProvider` construction from `activate()`.
  - Constructed and subscribed `ConfigProvider` inside `startGaugeServices()` after Gauge workspace or active Gauge document detection and Gauge CLI validation.

## GREEN

- Command: `node --test test/extension.test.js --test-name-pattern "core contributed Gauge commands|defers CLI and debug provider creation|config provider only after Gauge services"`
- Result: passed with 33 selected tests.
- Command: `node --test test/extension.test.js test/configProvider.test.js`
- Result: passed with 38 tests.

## Broader Check

- Command: `npm run check`
- Result: passed.
- Output summary: `test:unit` passed with 798 tests, `test:lsp` passed with 32 tests, `test:vscode` passed with 44 tests, and package dry-run completed.
