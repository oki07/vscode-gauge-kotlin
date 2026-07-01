# Test UI Project Root Gate

## Source behavior

Test UI execution must only dispatch targets that resolve to Gauge projects. If a target resolves through `projectFactory.getGaugeRootFromFilePath` but `projectFactory.isGaugeProject(root)` returns `false`, the target must be skipped instead of being run directly, batched, or converted into a project-scoped failed/repeat rerun.

## RED

Command:

```sh
node --test test/testController.test.js --test-name-pattern "non-Gauge projects"
```

Result: failed. `GaugeTestController skips included specification targets resolved to non-Gauge projects` dispatched `gauge.execute` for `/workspace/notes/specs/draft.spec`, and `GaugeTestController skips project-scoped reruns resolved to non-Gauge projects` dispatched `gauge.execute.repeat` with `{ projectRoot: "/workspace/notes" }`.

## GREEN

Command:

```sh
node --test test/testController.test.js --test-name-pattern "non-Gauge projects"
```

Result: passed. Both non-Gauge Test UI targets were filtered before execution, so no execute or repeat command was dispatched.

## Broader Check

Command:

```sh
node --test test/testController.test.js
```

Result: passed. All Test UI controller tests remained green with 30 passing tests.
