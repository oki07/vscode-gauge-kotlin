# Test UI queued run cancellation

Reference behavior:
- `references/gauge-vscode/src/execution/gaugeExecutor.ts` exposes
  `GaugeVSCodeCommands.StopExecution` and cancels the active Gauge execution
  when the user stops a run.
- The local Test UI adapter fans a single VS Code Test UI run out to multiple
  project-scoped Gauge executions when several Gauge projects are known.

Target behavior:
- Cancelling a VS Code Test UI run still sends `gauge.stopExecution` for the
  active Gauge process.
- After cancellation, the Test UI adapter does not enqueue additional
  project-scoped Gauge executions from the same run request.
- The same cancellation gate applies to run-all, batched specification, single
  target, failed rerun, and repeat rerun dispatch paths.

RED:
- `node --test test/testController.test.js --test-name-pattern "stops queuing Test UI project runs"`
- Result: failed before implementation because the second project root was
  executed after the cancellation token had been cancelled.

GREEN:
- `node --test test/testController.test.js --test-name-pattern "stops queuing Test UI project runs"`
- `node --test test/testController.test.js`
- Result: passed after implementation with 27 passing tests.
