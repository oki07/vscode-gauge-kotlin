# Preview Spectacle Fallback

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/markdownPreview/Formatter.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/markdownPreview/GaugeWebBrowserPreview.java`

## RED

- Command: `node --test test/preview.test.js --test-name-pattern "falls back"`
- Result: failed, 5 passed and 1 failed.
- Failure: missing Spectacle still showed the install prompt instead of generating fallback HTML.

## GREEN

- Command: `node --test test/preview.test.js --test-name-pattern "falls back"`
- Result: passed, 6 tests.
- Command: `node --test test/preview.test.js test/extension.test.js test/manifest.test.js`
- Result: passed, 44 tests.

## Broader Check

- Command: `npm run check`
- Result: passed, including 713 unit tests, 27 LSP tests, 38 VS Code and manifest tests, and packaging.

## Change

- Generated lightweight fallback HTML when the Spectacle plugin is unavailable.
- Escaped Gauge dynamic argument delimiters and other HTML-sensitive characters.
- Preserved table indentation in fallback preview output and opened the generated HTML file.
