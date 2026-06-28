# Test Controller Machine Readable Execution

## RED

Command:

```sh
node --test test/testController.test.js test/execution/executor.test.js --test-name-pattern "machine-readable|command flags|included Gauge"
```

Result: failed.

Evidence:

- `GaugeTestController` did not pass Test UI execution flags to the execution controller.
- `GaugeExecutionController.handleCommand()` ignored command flags beyond `failed`, `repeat`, and `parallel`, so `--machine-readable` and forced `--hide-suggestion` were not present in the Gauge command args.

## GREEN

Command:

```sh
node --test test/testController.test.js test/execution/executor.test.js --test-name-pattern "machine-readable|command flags|included Gauge"
```

Result: passed, 37/37 tests.

## Broader Check

Command:

```sh
node --test test/testController.test.js test/execution/executor.test.js test/execution/runArgs.test.js test/extension.test.js
```

Result: passed, 73/73 tests.

Command:

```sh
npm run check
```

Result: passed.
