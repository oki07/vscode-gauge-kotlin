# Run Install Plugins False

## Reference

- `references/gauge/cmd/run.go`
- `references/gauge-vscode/package.json`

Gauge run exposes `install-plugins` as a boolean option with a default of true. A launch configuration value of false must be represented explicitly as `--install-plugins=false`.

## RED

Command:

```sh
node --test test/execution/runArgs.test.js
```

Result: failed with 35 passing tests and 3 failing tests.

Failing coverage:

- `buildRunArgs.forGauge preserves explicit install plugin false option`
- `buildRunArgs.forGradle preserves explicit install plugin false option`
- `buildRunArgs.forMaven preserves explicit install plugin false option`

## GREEN

Command:

```sh
node --test test/execution/runArgs.test.js
```

Result: passed with 38 passing tests.

Implementation:

- Run argument serialization keeps `install-plugins: false` as `--install-plugins=false`.
- Other boolean false flags continue to be omitted unless they are explicitly false-valued Gauge booleans.
