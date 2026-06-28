# Test UI Unopened LSP Discovery

Scope: EXEC-A1 discovers unopened Gauge specifications and scenarios for VS Code Test Explorer from Gauge LSP.

Reference source:
- `references/gauge-vscode/src/explorer/specExplorer.ts`
- `references/gauge-vscode/src/protocol/gauge.proposed.md`

Target files:
- `src/testController.js`
- `src/extension.js`
- `test/testController.test.js`
- `test/extension.test.js`

RED:
- Command: `node --test --test-name-pattern "unopened workspace specs" test/testController.test.js`
- Result: failed, 0 passed and 1 failed.
- Failing test: `GaugeTestController resolves unopened workspace specs from Gauge LSP`.
- Failure: `discoverWorkspaceTests` was not implemented, so Test Explorer only knew open Gauge documents.

GREEN:
- Command: `node --test --test-name-pattern "unopened workspace specs" test/testController.test.js`
- Result: passed, 1 test passed.
- Command: `node --test --test-name-pattern "unopened workspace specs|Gauge Test UI execution" test/testController.test.js test/extension.test.js`
- Result: passed, 2 tests passed.

Related checks:
- Command: `node --test test/testController.test.js test/specExplorer.test.js test/extension.test.js test/gaugeWorkspace.test.js test/gaugeClients.test.js`
- Result: passed, 57 tests passed.

Broad check:
- Command: `npm run check`
- Result: passed.
- Unit tests: 593 passed.
- LSP tests: 21 passed.
- VS Code tests: 25 passed.
- Package: passed.
