# Test UI repeat run profile

Reference behavior:
- `references/gauge-vscode/src/execution/gaugeExecutor.ts` registers
  `GaugeVSCodeCommands.RepeatExecution` as a user-facing repeat execution
  command.
- `docs/tdd-evidence/2026-06-30-repeat-project-root.md` records that the local
  `gauge.execute.repeat` command accepts a caller-provided `projectRoot`.

Target behavior:
- The VS Code Test UI registers a non-default `Run Repeat` run profile.
- Invoking the profile calls `gauge.execute.repeat` with Test UI execution
  flags.
- Included Test UI items scope repeat reruns to their known Gauge project root,
  matching the existing failed rerun profile behavior.

RED:
- `node --test test/testController.test.js --test-name-pattern "repeat run profile"`
- Result: failed before implementation because no `Run Repeat` profile was
  registered and the test failed at `assert.ok(repeatProfile)`.

GREEN:
- `node --test test/testController.test.js --test-name-pattern "repeat Test UI reruns|repeat run profile"`
- `node --test test/testController.test.js`
- Result: passed after implementation with 26 passing tests.
