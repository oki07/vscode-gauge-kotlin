# Default project factory provider propagation

## Reference behavior

The source-only audit found that Gauge VS Code providers consistently receive the
project factory used to scope Gauge projects. The Kotlin extension already
creates a default project factory during activation, but some provider
registration paths kept the original options object and dropped that factory.

## Target behavior

Activation must pass the same default project factory to:

- `GaugeArgumentCodeActionProvider`
- `GaugeStepCodeActionProvider`
- `GaugeFoldingRangeProvider`
- `GaugeSemanticTokensProvider`

This keeps Gauge document actions, folding, and highlighting scoped to detected
Gauge projects even when callers do not inject a test project factory.

## RED

- Command: `node --test --test-name-pattern "activation propagates the default project factory to Gauge providers" test/extension.test.js`
- Result: failed.
- Failure summary: `created.argumentCodeActionProvider.options.projectFactory`
  was `undefined` while the activated workspace had a default project factory.

## GREEN

- Command: `node --test --test-name-pattern "activation propagates the default project factory to Gauge providers" test/extension.test.js`
- Result: passed.

## Broader checks

- Command: `node --test test/extension.test.js test/foldingRangeProvider.test.js test/semanticTokensProvider.test.js test/argumentCodeActions.test.js test/stepCodeActions.test.js`
- Result: passed, 110 tests.
- Command: `npm run check`
- Result: passed. Unit tests: 847 passed. LSP tests: 32 passed. VS Code tests: 48 passed. Package step passed.
