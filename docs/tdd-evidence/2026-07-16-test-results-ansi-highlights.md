# Test Results ANSI Highlights

## Behavior

- Machine-readable Gauge execution restores the colored console hierarchy in VS Code Test Results.
- Specification headings use cyan, scenario headings use yellow, passed results use green, failed
  results use red, and skipped results use yellow.
- Reconstructed output and existing ANSI sequences from test output keep CRLF line endings required
  by `TestRun.appendOutput`.

## RED

Command:

```text
node --test --test-name-pattern='restores Gauge highlights in Test Results output' test/testController.test.js
```

Result: 1 failed, 0 passed. Structured Gauge events produced no ANSI output for Test Results.

Target test:

- `test/testController.test.js`

## GREEN

Targeted command:

```text
node --test --test-name-pattern='restores Gauge highlights in Test Results output' test/testController.test.js
```

Result: 1 passed, 0 failed.

Related commands:

```text
node --test test/testController.test.js test/execution/lineProcessors.test.js
node --test --test-name-pattern='writes Test Results output with CRLF line endings|restores Gauge highlights in Test Results output' test/testController.test.js
```

Results: 50 passed, 0 failed for the controller and line-processor suite; 2 passed, 0 failed for
the focused CRLF and ANSI compatibility tests.

Full command:

```text
npm run check
```

Result: passed with 1,020 unit tests, 36 LSP tests, 54 VS Code tests, syntax checks, lint checks,
and VSIX packaging.
