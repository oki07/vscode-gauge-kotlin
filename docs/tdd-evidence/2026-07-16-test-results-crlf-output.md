# Test Results CRLF Output

## Behavior

- Gauge output shown by VS Code Test Results uses CRLF line endings as required by
  `TestRun.appendOutput`.
- LF, CR, and existing CRLF input are normalized to one CRLF sequence at the Test Results API
  boundary.
- Explicit separator events also append CRLF, so every new output line starts at column zero.

## RED

Command:

```text
node --test --test-name-pattern='writes Test Results output with CRLF line endings' test/testController.test.js
```

Result: 1 failed, 0 passed. `GaugeTestController` forwarded LF and CR unchanged and emitted a
single LF for separator events.

Target test:

- `test/testController.test.js`

## GREEN

Targeted command:

```text
node --test --test-name-pattern='writes Test Results output with CRLF line endings' test/testController.test.js
```

Result: 1 passed, 0 failed.

Related command:

```text
node --test test/testController.test.js test/execution/lineProcessors.test.js
```

Result: 49 passed, 0 failed.

Full command:

```text
npm run check
```

Result: passed with 1,019 unit tests, 36 LSP tests, 54 VS Code tests, syntax checks, lint checks,
and VSIX packaging.
