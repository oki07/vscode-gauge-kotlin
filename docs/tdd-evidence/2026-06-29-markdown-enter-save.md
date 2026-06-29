# Markdown Enter Save

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/GaugeEnterHandlerDelegate.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/GaugeUtil.java`

## RED

- Command: `node --test test/gaugeEnterHandler.test.js --test-name-pattern "Markdown Gauge specifications"`
- Result: failed, 2 passed and 1 failed.
- Failure reason: `GaugeEnterHandler` only saved documents with `languageId === "gauge"` and never checked Markdown `.md` Gauge specifications.

## GREEN

- Command: `node --test test/gaugeEnterHandler.test.js --test-name-pattern "Markdown Gauge specifications"`
- Result: passed, 3 tests.

- Command: `node --test test/gaugeEnterHandler.test.js`
- Result: passed, 3 tests.

- Command: `node --test test/extension.test.js --test-name-pattern "project factory to the Gauge enter handler|active Markdown Gauge specs|format command saves"`
- Result: passed, 25 tests.

## Broader Checks

- Command: `npm run check`
- Result: passed, 677 unit tests, 25 LSP tests, 36 VS Code surface tests, and VSIX packaging.

## Change

- `GaugeEnterHandler` now saves Markdown `.md` Gauge specifications after newline edits when the file resolves to a Gauge project.
- Extension activation passes the active project factory into the Gauge enter handler.
