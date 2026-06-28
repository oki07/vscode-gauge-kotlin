# Debug Adapter Languages

## Behavior

Gauge debug execution must map known runner languages to the VS Code debug adapter configurations used by the Gauge reference extension.

## RED

Command:

```sh
node --test test/execution/debug.test.js --test-name-pattern "runner languages|C# debug environment"
```

Result: failed. Non-JVM runner languages used the generic `type: language` fallback, and C# debug execution did not set `GAUGE_CSHARP_PROJECT_CONFIG`.

## GREEN

Command:

```sh
node --test test/execution/debug.test.js --test-name-pattern "runner languages|C# debug environment"
```

Result: passed.
