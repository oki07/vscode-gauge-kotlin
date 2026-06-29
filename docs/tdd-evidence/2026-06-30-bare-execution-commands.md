# Bare Execution Commands

## Reference Source

- `references/gauge-vscode/src/execution/gaugeExecutor.ts`
- `references/gauge-vscode/src/execution/runArgs.ts`

## RED

- Command: `node --test test/execution/executor.test.js --test-name-pattern "bare execution commands"`
- Result: failed, 48 passed and 1 failed.
- Failure: bare `gauge.execute` returned `undefined` without invoking the runner.

## GREEN

- Command: `node --test test/execution/executor.test.js --test-name-pattern "bare execution commands"`
- Result: passed, 49 tests.
- Command: `node --test test/execution/executor.test.js test/execution/runArgs.test.js test/extension.test.js`
- Result: passed, 107 tests.

## Broader Check

- Command: `npm run check`
- Result: passed, including 713 unit tests, 27 LSP tests, 38 VS Code and manifest tests, and packaging.

## Change

- Resolved bare `gauge.execute`, `gauge.debug`, and `gauge.execute.inParallel` commands through the active editor project.
- Preserved existing CodeLens behavior when a spec or scenario target is provided.
- Ran bare commands without a spec target so the active project executes all specs.
