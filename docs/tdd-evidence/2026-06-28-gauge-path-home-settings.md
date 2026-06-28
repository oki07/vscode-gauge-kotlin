# Gauge executable and home settings

## Scope

Add VS Code settings for a custom Gauge executable path and GAUGE_HOME, then apply them to Gauge CLI resolution and spawned Gauge processes.

## RED

Command:

```sh
node --test test/manifest.test.js test/cli.test.js test/execution/processRunner.test.js test/execution/executor.test.js
```

Result: failed as expected.

Failing expectations:

- `gauge.executablePath` and `gauge.home` were missing from the extension manifest.
- `CLI.instance` ignored a configured Gauge executable path and still used PATH lookup.
- Gauge execution did not add configured `GAUGE_HOME` to the runner environment.
- Debug execution did not pass configured `GAUGE_HOME` into the debugger environment.

## GREEN

Command:

```sh
node --test test/manifest.test.js test/cli.test.js test/execution/processRunner.test.js test/execution/executor.test.js
```

Result: passed, 58/58 tests.

## Broader checks

Command:

```sh
node --test test/gaugeProjectConfig.test.js test/gaugeWorkspace.test.js test/projectInitializer.test.js test/preview.test.js test/extension.test.js
```

Result: passed, 51/51 tests.

Command:

```sh
npm run check
```

Result: passed. Unit tests passed 557/557, LSP tests passed 20/20, VS Code tests passed 23/23, and package creation succeeded.
