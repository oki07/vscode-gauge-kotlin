# Spec Explorer Without Test UI Flags

## Scope

Spec Explorer run commands are normal explorer commands and must not force Test
UI machine-readable execution flags. VS Code Test UI remains responsible for
passing `hide-suggestion` and `machine-readable` when it invokes execution.

## References

- `references/gauge-vscode/src/explorer/specExplorer.ts`
- `references/gauge-vscode/src/execution/gaugeExecutor.ts`
- `vscode-gauge-kotlin/src/testController.js`

## RED

Command:

```sh
node --test --test-name-pattern "without Test UI flags" test/specExplorer.test.js
```

Result:

- Failed with 1 selected test.
- Failure: `gauge.specexplorer.runAllActiveProjectSpecs`,
  `gauge.specexplorer.runNode`, and `gauge.specexplorer.debugNode` each
  delegated an extra `{ "hide-suggestion": true, "machine-readable": true }`
  flags object.

## GREEN

Command:

```sh
node --test --test-name-pattern "without Test UI flags" test/specExplorer.test.js
```

Result:

- Passed with 1 selected test.

## Broader Checks

Commands:

```sh
node --test test/specExplorer.test.js
node --test test/execution/executor.test.js test/testController.test.js
npm run check
```

Results:

- `node --test test/specExplorer.test.js` passed with 5 tests.
- `node --test test/execution/executor.test.js test/testController.test.js`
  passed with 84 tests.
- `npm run check` passed: typecheck, lint, unit tests 790/790,
  LSP tests 32/32, VS Code tests 43/43, and package.

## Implementation

- Removed Spec Explorer-owned Test UI flag injection.
- Kept Spec Explorer command delegation through the existing execution
  controller commands.
- Left Test UI flag ownership in `GaugeTestController`.
