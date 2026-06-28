# Launch process options

## Scope

Port the IntelliJ Gauge run configuration support for process-level execution settings into the VS Code launch configuration:

- `cwd` sets the Gauge process working directory. Relative paths resolve from the Gauge project root.
- `processEnv` adds environment variables to the Gauge process.
- `args` appends additional Gauge command-line arguments.
- Process-only launch attributes are not forwarded as Gauge flags.

## RED

Commands:

```sh
node --test test/execution/runArgs.test.js
node --test test/execution/executor.test.js
node --test test/manifest.test.js
```

Result: failed as expected.

Failing expectations:

- `args` was serialized as `--args` instead of raw additional Gauge arguments.
- `cwd` and `processEnv` were forwarded as Gauge flags instead of runner process options.
- `extractGaugeExecutionOption` did not exist.
- The extension manifest did not expose `cwd`, `processEnv`, or `args` launch properties.

## GREEN

Commands:

```sh
node --test test/execution/runArgs.test.js
node --test test/execution/executor.test.js
node --test test/manifest.test.js
```

Result: passed.

Combined command:

```sh
node --test test/execution/runArgs.test.js test/execution/executor.test.js test/manifest.test.js
```

Result: passed, 64/64 tests.

## Broader checks

Command:

```sh
npm run check
```

Result: passed. Unit tests passed 575/575, LSP tests passed 20/20, VS Code tests passed 24/24, and package creation succeeded.
