# CodeLens Opens Test Results

## Behavior

- A CodeLens-triggered Gauge test run requests Test Results focus even when the panel is closed.
- The implementation uses the public VS Code `TestRunRequest.preserveFocus` contract instead of
  an internal workbench command.
- Gutter-triggered requests keep the focus behavior supplied by VS Code itself.

## RED

Command:

```text
node --test --test-name-pattern='targeted TestRun for CodeLens' test/testController.test.js
```

Result: 1 failed, 0 passed. The programmatic request did not set `preserveFocus`, so VS Code was
not asked to open Test Results.

Target test:

- `test/testController.test.js`

## GREEN

Targeted command:

```text
node --test --test-name-pattern='targeted TestRun for CodeLens' test/testController.test.js
```

Result: 1 passed, 0 failed.

Related command:

```text
node --test test/testController.test.js test/extension.test.js test/execution/outputChannel.test.js
```

Result: 83 passed, 0 failed.

Full command:

```text
npm run check
```

Result: passed with 1,016 unit tests, 36 LSP tests, 54 VS Code tests, syntax checks,
lint checks, and VSIX packaging.
