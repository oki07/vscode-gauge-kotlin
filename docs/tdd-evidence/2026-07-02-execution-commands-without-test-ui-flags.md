# Execution Commands Without Test UI Flags

## Scope

Normal contributed Gauge execution commands must delegate to the execution controller without injecting Test UI machine-readable flags. Test UI runs remain responsible for passing their own `hide-suggestion` and `machine-readable` flags.

## References

- `references/gauge-vscode/src/execution/gaugeExecutor.ts`
- `references/gauge-vscode/src/execution/runArgs.ts`
- `vscode-gauge-kotlin/src/testController.js`

## RED

Command:

```sh
node --test --test-name-pattern "without Test UI machine-readable flags" test/extension.test.js
```

Result:

- Failed with 1 selected test.
- Failure: `gauge.execute.specification` delegated the node plus `{ "hide-suggestion": true, "machine-readable": true }` instead of the node alone.

## GREEN

Command:

```sh
node --test --test-name-pattern "without Test UI machine-readable flags" test/extension.test.js
```

Result:

- Passed with 1 selected test.

## Broader Checks

Commands:

```sh
node --test test/extension.test.js
node --test test/testController.test.js test/execution/executor.test.js
npm run check
```

Results:

- `node --test test/extension.test.js` passed with 32 tests.
- `node --test test/testController.test.js test/execution/executor.test.js` passed with 84 tests.
- `npm run check` passed: typecheck, lint, unit tests 790/790,
  LSP tests 32/32, VS Code tests 43/43, and package.

## Implementation

- Removed default Test UI flag injection from the extension command wrapper.
- Kept explicit single flag-object invocation support by normalizing it to `[undefined, flags]`.
- Left Test UI flag ownership in `GaugeTestController`.
