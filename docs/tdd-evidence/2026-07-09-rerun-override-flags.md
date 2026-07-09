# Rerun Override Flags

## Reference

- `references/gauge/cmd/run.go` keeps `verbose`, `simple-console`, `machine-readable`, `dir`, and `log-level` as override flags for `--failed` and `--repeat`.
- Normal filters such as `tags` are reset for reruns.

## RED

Command:

```sh
node --test test/execution/runArgs.test.js
```

Result: failed with 3 tests because Gauge, Gradle, and Maven rerun argument builders only kept the rerun command flag and dropped `verbose`, `simple-console`, `dir`, and `log-level`.

## GREEN

Command:

```sh
node --test test/execution/runArgs.test.js
```

Result: passed with 34 tests.

Broader check:

```sh
node --test test/execution/runArgs.test.js test/execution/executor.test.js
```

Result: passed with 89 tests.
