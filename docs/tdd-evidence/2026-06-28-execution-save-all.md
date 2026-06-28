# Save workspace documents before execution

## Scope

Save workspace documents before starting a Gauge execution, matching the IntelliJ runner behavior.

## RED

Command:

```sh
node --test test/execution/executor.test.js
```

Result: failed as expected.

Failing expectation:

- Gauge execution started the runner without calling `workspace.saveAll(false)`.

## GREEN

Command:

```sh
node --test test/execution/executor.test.js
```

Result: passed, 35/35 tests.

## Broader checks

Command:

```sh
node --test test/execution/executor.test.js test/testController.test.js test/gaugeWorkspaceFeature.test.js test/extension.test.js
```

Result: passed, 61/61 tests.

Command:

```sh
npm run check
```

Result: passed. Unit tests passed 562/562, LSP tests passed 20/20, VS Code tests passed 23/23, and package creation succeeded.
