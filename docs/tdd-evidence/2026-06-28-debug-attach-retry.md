# Debug Attach Retry

## Behavior

Gauge debug execution must retry VS Code debugger attach while the runner process is still starting.

## RED

Command:

```sh
node --test test/execution/debug.test.js --test-name-pattern "retries VS Code attach debugging"
```

Result: failed. `startDebugger()` propagated the first `startDebugging()` rejection without retrying.

## GREEN

Command:

```sh
node --test test/execution/debug.test.js --test-name-pattern "retries VS Code attach debugging"
```

Result: passed.
