# Test Controller Bridge

## Behavior

Gauge execution events must be wired into VS Code Test UI so machine-readable Gauge output can update a `TestRun`.

## RED

Command:

```sh
node --test test/testController.test.js test/extension.test.js --test-name-pattern "GaugeTestController|Test UI execution events"
```

Result: failed. `src/testController.js` was missing, and activation did not create a Gauge test controller or pass its execution event sink to the execution controller.

## GREEN

Command:

```sh
node --test test/testController.test.js test/extension.test.js --test-name-pattern "GaugeTestController|Test UI execution events"
```

Result: passed.
