# Existing project folder rejection

## Scope

Reject project creation when the requested target folder already exists, including existing non-Gauge folders.

Reference source:

- `references/gauge-vscode/src/init/projectInit.ts`

Target source:

- `src/init/projectInit.js`
- `test/projectInitializer.test.js`

## RED

Command:

```sh
node --test --test-name-pattern "existing non-Gauge directory" test/projectInitializer.test.js
```

Result: failed as expected, 0/1 tests passed.

Observed failure:

- Existing non-Gauge target folders were initialized instead of rejected.

## GREEN

Command:

```sh
node --test --test-name-pattern "existing non-Gauge directory" test/projectInitializer.test.js
```

Result: passed, 1/1 tests.

Related command:

```sh
node --test test/projectInitializer.test.js test/extension.test.js
```

Result: passed, 29/29 tests.

## Broader checks

Command:

```sh
npm run check
```

Result: passed. Unit tests passed 609/609, LSP tests passed 22/22, VS Code tests passed 26/26, and package creation succeeded.
