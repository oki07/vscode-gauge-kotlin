# Execution Project Root Gate

## Source behavior

Execution commands must only run Gauge projects. When a root resolver returns a directory but `projectFactory.isGaugeProject(root)` reports `false`, the executor must not treat that directory as a runnable Gauge root.

## RED

Command:

```sh
node --test test/execution/executor.test.js --test-name-pattern "resolved root"
```

Result: failed. `execute specification ignores active specs when the resolved root is not a Gauge project` returned `true`, proving the runner executed with `/workspace/notes` even though `isGaugeProject(root)` returned `false`.

## GREEN

Command:

```sh
node --test test/execution/executor.test.js --test-name-pattern "resolved root"
```

Result: passed. Active specification execution now rejects roots when `isGaugeProject(root)` returns `false`, so the runner is not called for non-Gauge roots.

## Broader Check

Command:

```sh
node --test test/execution/executor.test.js
```

Result: passed. All executor tests remained green.
