# Generate Stub New File Path

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/annotator/CreateStepImplFix.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/annotator/GaugeCreateClassAction.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/annotator/FileManager.java`

## RED

- Command: `node --test test/generateStub.test.js --test-name-pattern "creates missing files"`
- Result: failed, 3 passed and 1 failed.
- Failure: `New File` step generation did not prompt for an implementation file path.

## GREEN

- Command: `node --test test/generateStub.test.js`
- Result: passed, 4 tests.
- Command: `node --test test/generateStub.test.js test/extension.test.js test/argumentCodeActions.test.js`
- Result: passed, 45 tests.

## Broader Check

- Command: `npm run check`
- Result: passed, including 713 unit tests, 27 LSP tests, 38 VS Code and manifest tests, and packaging.

## Change

- Prompted for a new Kotlin implementation file path when `New File` is selected.
- Resolved relative implementation paths against the active Gauge project root.
- Passed the resolved implementation file path to `gauge/putStubImpl` before applying generated edits.
