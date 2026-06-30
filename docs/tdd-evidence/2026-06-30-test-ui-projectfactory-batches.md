# Test UI projectFactory batch splitting

Reference behavior:
- `references/gauge-vscode/src/execution/gaugeExecutor.ts` resolves a
  specification execution batch from the first selected target and runs the
  batch inside that Gauge project.
- The local VS Code Test UI adapter can create a multi-target batch before the
  execution controller sees the selected targets.

Target behavior:
- Included Test UI specification items are split by known Gauge project root
  before dispatching `gauge.execute.specification`.
- The split uses active LSP client roots when available and falls back to
  `projectFactory.getGaugeRootFromFilePath` while workspace services are still
  catching up.
- Targets with no known project root keep the existing single-batch fallback.

RED:
- `node --test test/testController.test.js --test-name-pattern "projectFactory roots to split specification batches"`
- Result: failed before implementation because two different Gauge project
  specs were dispatched in one specification batch.

GREEN:
- `node --test test/testController.test.js --test-name-pattern "projectFactory roots to split specification batches"`
- `node --test test/testController.test.js`
- Result: passed after implementation with 28 passing tests.
