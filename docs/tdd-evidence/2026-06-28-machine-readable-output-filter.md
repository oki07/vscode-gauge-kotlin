# Machine-readable output filtering

## Scope

Hide raw Gauge machine-readable JSON events from the Gauge execution output channel while still routing those lines to execution event processors.

Reference sources:

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/runner/GaugeOutputToGeneralTestEventsProcessor.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/runner/processors/StandardOutputEventProcessor.java`

Target source:

- `src/execution/processRunner.js`
- `test/execution/processRunner.test.js`

## RED

Command:

```sh
node --test --test-name-pattern "hides machine-readable JSON" test/execution/processRunner.test.js
```

Result: failed as expected, 0/1 tests passed.

Observed failure:

- Raw `specStart` JSON was included in the output channel.

## GREEN

Command:

```sh
node --test --test-name-pattern "hides machine-readable JSON" test/execution/processRunner.test.js
```

Result: passed, 1/1 tests.

Related command:

```sh
node --test test/execution/processRunner.test.js test/execution/lineProcessors.test.js test/execution/executor.test.js test/testController.test.js
```

Result: passed, 68/68 tests.

## Broader checks

Command:

```sh
npm run check
```

Result: passed. Unit tests passed 604/604, LSP tests passed 22/22, VS Code tests passed 26/26, and package creation succeeded.
