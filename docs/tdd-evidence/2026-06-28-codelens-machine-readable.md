# CodeLens Machine-Readable Execution

## Scope

Parity: Gauge CodeLens run and debug actions pass the same machine-readable execution flags used by the Test Controller so editor gutter-style runs can feed structured test events.

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/GaugeRunConfiguration.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/GaugeCommandLineState.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/TestRunLineMarkerProvider.java`
- `references/gauge-vscode/src/execution/gaugeExecutor.ts`

Target files:
- `src/codeLensProvider.js`
- `test/codeLensProvider.test.js`

## RED

Command:

```sh
node --test --test-name-pattern "GaugeCodeLensProvider adds run and debug lenses" test/codeLensProvider.test.js
```

Result:

- Failed: 1 failed, 0 passed.
- Failure: CodeLens commands passed only the target argument, so `flags` was `undefined`.

## GREEN

Command:

```sh
node --test --test-name-pattern "GaugeCodeLensProvider adds run and debug lenses" test/codeLensProvider.test.js
```

Result:

- Passed: 1 passed, 0 failed.

## Related Check

Command:

```sh
node --test test/codeLensProvider.test.js test/execution/executor.test.js test/testController.test.js test/extension.test.js
```

Result:

- Passed: 73 passed, 0 failed.

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
