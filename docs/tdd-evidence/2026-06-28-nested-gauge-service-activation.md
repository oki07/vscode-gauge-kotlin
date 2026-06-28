# Nested Gauge Service Activation

## Scope

Parity: activation starts Gauge workspace services when a VS Code workspace folder contains nested Gauge projects.

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/GaugeModuleComponent.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/GaugeUtil.java`
- `references/gauge-vscode/src/gaugeWorkspace.ts`

Target files:
- `src/extension.js`
- `src/gaugeWorkspace.js`
- `src/project/projectFactory.js`
- `test/extension.test.js`
- `test/projectFactory.test.js`

## RED

Command:

```sh
node --test --test-name-pattern "activation starts Gauge workspace services" test/extension.test.js
```

Result:

- Failed: 1 failed, 1 passed.
- Failure: `activation starts Gauge workspace services for Gauge projects` only called `isGaugeProject("/workspace")` and did not call `findGaugeProjectRoots("/workspace")`.

## GREEN

Command:

```sh
node --test --test-name-pattern "activation starts Gauge workspace services" test/extension.test.js
```

Result:

- Passed: 2 passed, 0 failed.

## Related Check

Command:

```sh
node --test test/extension.test.js test/gaugeWorkspace.test.js test/projectFactory.test.js
```

Result:

- Passed: 43 passed, 0 failed.

## Broad Check

Command:

```sh
npm run check
```

Result:

- Passed.
- Unit tests: 594 passed, 0 failed.
- LSP tests: 21 passed, 0 failed.
- VS Code tests: 25 passed, 0 failed.
- Package step completed.
