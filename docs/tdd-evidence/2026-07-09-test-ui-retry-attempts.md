# Test UI retry attempts

## Reference source

- `references/gauge/execution/rerun/rerun.go`
- `references/gauge/reporter/jsonConsole_test.go`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/runner/processors/ScenarioEventProcessor.java`

Gauge can emit multiple `ScenarioEnd` events for the same scenario when retry
execution is enabled. The VS Code Test UI adapter must keep repeated scenario
attempts distinct and must aggregate the parent specification from the latest
logical scenario result.

## RED

Command:

```sh
node --test test/testController.test.js -t "GaugeTestController keeps retry attempts distinct for repeated scenario ids"
```

Result: failed. The second scenario attempt reused the original Test UI item id,
and the parent specification stayed failed after the retry passed.

## GREEN

Command:

```sh
node --test test/testController.test.js -t "GaugeTestController keeps retry attempts distinct for repeated scenario ids"
```

Result: passed.

## Regression

Command:

```sh
node --test test/testController.test.js
```

Result: passed, 32 tests.

Command:

```sh
npm run check
```

Result: passed.
