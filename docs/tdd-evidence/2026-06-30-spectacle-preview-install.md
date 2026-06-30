# Spectacle Preview Install Action

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/markdownPreview/GaugeWebBrowserPreview.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/markdownPreview/Spectacle.java`
- Existing preview fallback in `src/preview.js`

## RED

- Command: `node --test test/preview.test.js --test-name-pattern "Spectacle"`
- Result: failed, 5 passed and 2 failed.
- Failure: missing Spectacle only produced the fallback preview; no `Install Spectacle` action was shown and selecting it could not call `installGaugeRunner("spectacle")`.

## GREEN

- Command: `node --test test/preview.test.js --test-name-pattern "Spectacle"`
- Result: passed, 7 tests.
- Command: `node --test test/preview.test.js test/extension.test.js`
- Result: passed, 35 tests.

## Broader Check

- Command: `npm run check`
- Result: passed, including 722 unit tests, 27 LSP tests, 39 VS Code and manifest tests, and packaging.

## Change

- Added a missing Spectacle notification with an `Install Spectacle` action.
- Calls `cli.installGaugeRunner("spectacle")` only when the user selects that action.
- Keeps the existing formatted fallback preview behavior when Spectacle is not installed.
