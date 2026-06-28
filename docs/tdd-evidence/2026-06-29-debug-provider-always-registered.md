# Debug Provider Always Registered

Reference source:
- `references/gauge-vscode/package.json`
- `references/gauge-vscode/src/extension.ts`

Target behavior:
- The Gauge debug configuration provider is registered during activation even when Gauge workspace services are not needed.
- Direct `gauge` debug configurations are still rejected with the existing guidance.
- CLI creation remains deferred when no Gauge services are needed.

RED:
- Command: `node --test test/extension.test.js --test-name-pattern "defers CLI creation"`
- Result: failed, 21 passed and 1 failed.
- Failing test:
  - `activation defers CLI creation when Gauge services are not needed`

GREEN:
- Command: `node --test test/extension.test.js --test-name-pattern "core contributed|defers CLI creation|starts Gauge workspace services"`
- Result: passed, 22 tests.

Broader checks:
- Command: `npm run check`
- Result: passed, 662 unit tests, 25 LSP tests, 33 VS Code surface tests, and VSIX packaging.
- Command: `git diff --check`
- Result: passed.
- Command: `../.codex/hooks/check-source-language.sh`
- Result: passed.
