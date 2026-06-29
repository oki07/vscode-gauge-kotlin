# Markdown Test UI Discovery

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileTypeFactory.java`
- `references/gauge-vscode/src/explorer/specExplorer.ts`

## RED

- Command: `node --test test/testController.test.js --test-name-pattern "open Markdown Gauge specs"`
- Result: failed, 19 passed and 1 failed.
- Failure reason: `GaugeTestController` only discovered open documents with `languageId === "gauge"` and ignored Markdown `.md` Gauge specifications.

## GREEN

- Command: `node --test test/testController.test.js --test-name-pattern "open Markdown Gauge specs"`
- Result: passed, 20 tests.

- Command: `node --test test/testController.test.js`
- Result: passed, 20 tests.

## Broader Checks

- Command: `npm run check`
- Result: passed, 679 unit tests, 26 LSP tests, 36 VS Code surface tests, and VSIX packaging.

## Change

- Test UI open-document discovery now creates specification and scenario test items from Markdown `.md` Gauge specifications when the file resolves to a Gauge project.
