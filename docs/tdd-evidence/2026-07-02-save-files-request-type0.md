# Save Files Request Type

Scope: Gauge workspace dynamic feature request metadata for `workspace/saveFiles`.

Reference source:
- `references/gauge-vscode/src/protocol/gauge.proposed.ts`
- `references/gauge-vscode/src/gaugeWorkspace.proposed.ts`

Target files:
- `src/gaugeWorkspaceFeature.js`
- `test/gaugeWorkspaceFeature.test.js`

RED:
- Command: `node --test test/gaugeWorkspaceFeature.test.js --test-name-pattern "saveFiles requests"`
- Result: failed, 1 passed and 1 failed.
- Failing test: `GaugeWorkspaceFeature advertises and handles workspace saveFiles requests`
- Failure summary: `feature.messages` was only a plain `{ method }` object and did not expose `numberOfParams: 0` or `parameterStructures: auto` like `RequestType0`.

GREEN:
- Command: `node --test test/gaugeWorkspaceFeature.test.js --test-name-pattern "saveFiles requests"`
- Result: passed, 2 tests passed.

Related checks:
- Command: `node --test test/gaugeWorkspaceFeature.test.js test/gaugeWorkspace.test.js test/extension.test.js`
- Result: passed, 62 tests passed.

Broad check:
- Command: `npm run check`
- Result: passed.
- Unit tests: 797 passed.
- LSP tests: 32 passed.
- VS Code tests: 43 passed.
- Package: passed.
