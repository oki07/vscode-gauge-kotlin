# Machine Readable Execution Events

## Behavior

Gauge execution must parse machine-readable JSON output lines into structured execution events that can feed VS Code Test UI integration.

## RED

Command:

```sh
node --test test/execution/lineProcessors.test.js test/execution/executor.test.js --test-name-pattern "MachineReadableEventProcessor|machine-readable output"
```

Result: failed. `MachineReadableEventProcessor` did not exist, and executor stdout processing did not route JSON execution events to a sink.

## GREEN

Command:

```sh
node --test test/execution/lineProcessors.test.js test/execution/executor.test.js --test-name-pattern "MachineReadableEventProcessor|machine-readable output"
```

Result: passed.
