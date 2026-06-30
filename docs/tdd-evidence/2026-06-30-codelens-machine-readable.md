# CodeLens Machine Readable Execution

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/TestRunLineMarkerProvider.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/GaugeRunConfiguration.java`
- Existing VS Code Test UI flags in `src/testController.js`

## RED

- Command: `node --test test/codeLensProvider.test.js --test-name-pattern "run and debug lenses"`
- Result: failed, 9 passed and 1 failed.
- Failure: specification and scenario Run/Debug CodeLens commands passed only `hide-suggestion`, without `machine-readable`.

## GREEN

- Command: `node --test test/codeLensProvider.test.js --test-name-pattern "run and debug lenses"`
- Result: passed, 10 tests.
- Command: `node --test test/codeLensProvider.test.js test/extension.test.js test/testController.test.js`
- Result: passed, 59 tests.

## Broader Check

- Command: `npm run check`
- Result: passed, including 721 unit tests, 27 LSP tests, 39 VS Code and manifest tests, and packaging.

## Change

- Added `machine-readable` to the flags passed by specification and scenario Run/Debug CodeLens commands.
- Kept the existing `hide-suggestion` flag and command argument shape unchanged.
