# Debug Parallel Options

## Behavior

Debug execution must not pass parallel execution options from launch configuration.

## RED

Command:

```sh
node --test test/execution/executor.test.js --test-name-pattern "debug node ignores launch parallel options"
```

Result: failed. Debug args still included `-PinParallel=true` and `-Pnodes=3`.

## GREEN

Command:

```sh
node --test test/execution/executor.test.js --test-name-pattern "debug node ignores launch parallel options"
```

Result: passed.
