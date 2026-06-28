# Java build run args environment string

## Scope

Implement parity for Java build tool Gauge runs when the launch option uses a single environment name.

Reference source:

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/GaugeRunConfiguration.java`

Target source:

- `src/execution/runArgs.js`
- `test/execution/runArgs.test.js`

## RED

Command:

```sh
node --test --test-name-pattern "single environment name" test/execution/runArgs.test.js
```

Result: failed as expected, 0/2 tests passed.

Observed failure:

- `buildRunArgs.forGradle` threw `TypeError: env.join is not a function`.
- `buildRunArgs.forMaven` threw `TypeError: env.join is not a function`.

## GREEN

Command:

```sh
node --test --test-name-pattern "single environment name" test/execution/runArgs.test.js
```

Result: passed, 2/2 tests.

Related command:

```sh
node --test test/execution/runArgs.test.js
```

Result: passed, 28/28 tests.

## Broader checks

Command:

```sh
npm run check
```

Result: passed. Unit tests passed 602/602, LSP tests passed 22/22, VS Code tests passed 26/26, and package creation succeeded.
