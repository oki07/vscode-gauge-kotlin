# Test Results Execution Lifecycle

## Behavior

- Gauge CodeLens execution creates a targeted VS Code `TestRun` before Maven compilation starts.
- Gutter and CodeLens execution use the same `GaugeTestController` and machine-readable execution
  path.
- Gauge execution output remains available in the output channel without automatically revealing
  the Output panel over Test Results.
- Explicit non-test operations can still request output channel reveal behavior.

## RED

Command:

```text
node --test --test-name-pattern='keeps test results visible|targeted TestRun for CodeLens|parallel CodeLens execution|CodeLens execution commands delegate' test/execution/outputChannel.test.js test/testController.test.js test/extension.test.js
```

Result: 4 failed, 0 passed. The output channel called `show(true)`, CodeLens commands bypassed the
test controller, and no targeted CodeLens `TestRun` API existed.

Target tests:

- `test/execution/outputChannel.test.js`
- `test/testController.test.js`
- `test/extension.test.js`

## GREEN

Targeted command:

```text
node --test --test-name-pattern='keeps test results visible|targeted TestRun for CodeLens|parallel CodeLens execution|CodeLens execution commands delegate' test/execution/outputChannel.test.js test/testController.test.js test/extension.test.js
```

Result: 4 passed, 0 failed.

Related command:

```text
node --test test/execution/outputChannel.test.js test/execution/processRunner.test.js test/execution/executor.test.js test/testController.test.js test/extension.test.js test/cli.test.js
```

Result: 163 passed, 0 failed.

Full command:

```text
npm run check
```

Result: passed with 1,016 unit tests, 36 LSP tests, 54 VS Code tests, syntax checks,
lint checks, and VSIX packaging.
