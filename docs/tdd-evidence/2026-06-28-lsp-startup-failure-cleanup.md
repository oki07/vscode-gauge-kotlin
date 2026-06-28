# LSP Startup Failure Cleanup

## Scope

Parity: Gauge workspace services report language server startup failures and do not leave stale clients registered after a failed start.

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/GaugeModuleComponent.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/core/GaugeExceptionHandler.java`
- `references/gauge-vscode/src/gaugeWorkspace.ts`

Target files:
- `src/gaugeWorkspace.js`
- `test/gaugeWorkspace.test.js`

## RED

Command:

```sh
node --test --test-name-pattern "language server startup failures" test/gaugeWorkspace.test.js
```

Result:

- Failed: 1 failed, 0 passed.
- Failure: `GaugeWorkspace removes clients and reports language server startup failures` received an unwanted rejection with message `daemon failed`.

## GREEN

Command:

```sh
node --test --test-name-pattern "language server startup failures" test/gaugeWorkspace.test.js
```

Result:

- Passed: 1 passed, 0 failed.

## Related Check

Command:

```sh
node --test test/gaugeWorkspace.test.js test/gaugeClients.test.js test/extension.test.js
```

Result:

- Passed: 42 passed, 0 failed.

## Broad Check

Command:

```sh
npm run check
```

Result:

- Passed.
- Unit tests: 595 passed, 0 failed.
- LSP tests: 22 passed, 0 failed.
- VS Code tests: 25 passed, 0 failed.
- Package step completed.
