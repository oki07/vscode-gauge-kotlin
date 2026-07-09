# Format Skip Empty Line Insertions

## Reference

- `references/gauge/cmd/format.go`
- `references/gauge/formatter/formatter.go`

Gauge CLI exposes `gauge format --skip-empty-line-insertions` to preserve missing blank lines while formatting spec and concept files.

## RED

Command:

```sh
node --test test/formatProvider.test.js
```

Result: failed with 9 passing tests and 1 failing test.

Failing coverage:

- `GaugeFormatProvider passes skip empty line insertion option to gauge format`

## GREEN

Command:

```sh
node --test test/formatProvider.test.js
```

Result: passed with 10 passing tests.

Implementation:

- Formatter reads `gauge.formatting.skipEmptyLineInsertions`.
- Formatter passes `--skip-empty-line-insertions` to Gauge CLI only when the setting is enabled.
