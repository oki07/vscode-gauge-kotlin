# Current Gauge Run Schema

## Reference

- `references/gauge/cmd/run.go` defines `--sort` as a string option with `alpha` and `random`.
- `references/gauge/cmd/run.go` defines `--random-seed` for reproducible random execution.
- `references/gauge/cmd/run.go` describes `--table-rows` ranges with `2-4`.

## RED

Command:

```sh
node --test test/manifest.test.js
```

Result: failed with 1 test because the debugger schema still exposed `sort` as a boolean, omitted `random-seed`, and described `table-rows` ranges as `2_4`.

## GREEN

Command:

```sh
node --test test/manifest.test.js
```

Result: passed with 14 tests.
