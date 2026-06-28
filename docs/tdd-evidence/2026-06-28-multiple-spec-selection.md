# Multiple spec selection execution

## Scope

Port IntelliJ's selected spec and directory execution behavior into the VS Code extension:

- Add an Explorer context menu entry for running selected spec files or directories.
- Accept VS Code Explorer selected resources in `gauge.execute.specification`.
- Run selected `.spec` and `.md` files.
- Run selected directories only when they contain immediate spec files.
- Pass multiple raw Gauge targets as separate arguments.
- Pass multiple Gradle and Maven `specsDir` targets with the Gauge `||` delimiter.

## RED

Commands:

```sh
node --test test/execution/runArgs.test.js
node --test test/execution/executor.test.js
node --test test/manifest.test.js
```

Result: failed as expected.

Failing expectations:

- Raw Gauge execution pushed the selected targets array as one argument.
- Gradle and Maven `specsDir` values used array stringification instead of the Gauge `||` delimiter.
- `gauge.execute.specification` did not handle Explorer selected resources.
- The Explorer context menu did not expose selected spec or directory execution.

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

Result: passed, 68/68 tests.

## Broader checks

Command:

```sh
npm run check
```

Result: passed. Unit tests passed 579/579, LSP tests passed 20/20, VS Code tests passed 24/24, and package creation succeeded.
