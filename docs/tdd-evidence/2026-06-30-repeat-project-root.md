# Repeat execution project root

Reference behavior:
- `references/gauge-vscode/src/execution/gaugeExecutor.ts` exposes repeat
  execution as a project-scoped command path.

Target behavior:
- `gauge.execute.repeat` now accepts a command argument with `projectRoot`,
  matching `gauge.execute.failed` and avoiding a project prompt when the caller
  already knows the target Gauge project.

RED:
- `node --test test/execution/executor.test.js --test-name-pattern "repeat execution uses the provided project root"`
- Result: failed before implementation because repeat execution ignored
  `projectRoot` and opened a project quick pick.

GREEN:
- `node --test test/execution/executor.test.js --test-name-pattern "repeat execution uses the provided project root"`
- `node --test test/execution/executor.test.js`
- Result: passed after implementation.
