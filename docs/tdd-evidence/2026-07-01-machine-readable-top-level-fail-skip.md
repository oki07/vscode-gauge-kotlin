# Machine Readable Top Level Fail And Skip Events

## Reference behavior

- Reference path: `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/runner/event/ExecutionEvent.java`
- Reference path: `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/runner/processors/UnexpectedEndProcessor.java`
- Local path: `src/execution/lineProcessors.js`

Gauge machine-readable execution events include top-level `fail` and `skip`
types. IntelliJ maps these unexpected end events to a synthetic failed or
ignored test under the suite. VS Code Test UI can represent the same behavior
with synthetic started, failed or ignored, and finished events.

## RED

Command:

```text
node --test --test-name-pattern "top-level fail and skip" test/execution/lineProcessors.test.js
```

Result: failed. `MachineReadableEventProcessor` produced `[]` for top-level
`fail` and `skip` JSON events.

## GREEN

Command:

```text
node --test --test-name-pattern "top-level fail and skip" test/execution/lineProcessors.test.js
```

Result: passed with 1 selected test after mapping `fail` to a `Failed`
synthetic test and `skip` to an `Ignored` synthetic test.

## Broader checks

Command:

```text
node --test test/execution/lineProcessors.test.js
```

Result: passed with 10 tests.

Command:

```text
node --test test/execution/lineProcessors.test.js test/testController.test.js
```

Result: passed with 40 tests.
