# Project root selection runs all specs

## Scope

Run all Gauge specifications when the Explorer selected resource is the project root directory.

Reference source:

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/SpecsExecutionProducer.java`

Target source:

- `src/execution/executor.js`
- `test/execution/executor.test.js`

## RED

Command:

```sh
node --test --test-name-pattern "Explorer selected resource is the project root" test/execution/executor.test.js
```

Result: failed as expected, 0/1 tests passed.

Observed failure:

- The command returned `undefined` when the selected project root did not contain a direct `.spec` child.

## GREEN

Command:

```sh
node --test --test-name-pattern "Explorer selected resource is the project root" test/execution/executor.test.js
```

Result: passed, 1/1 tests.

Related command:

```sh
node --test test/execution/executor.test.js test/explorer/specExplorer.test.js
```

Result: passed, 40/40 tests.

## Broader checks

Command:

```sh
npm run check
```

Result: passed. Unit tests passed 605/605, LSP tests passed 22/22, VS Code tests passed 26/26, and package creation succeeded.
