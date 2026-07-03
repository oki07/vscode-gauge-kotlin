# Preview Table Block Formatting TDD Evidence

## Scope

- Parity item: IntelliJ Gauge preview fallback formatting for Gauge table blocks.
- Reference behavior:
  - IntelliJ `Formatter` inserts a blank line before Gauge table blocks, normalizes table row indentation to one tab, collapses extra blank lines before table blocks, and escapes dynamic argument angle brackets.
- Reference paths:
  - `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/markdownPreview/Formatter.java`
  - `references/intellij-gauge-plugin/tests/com/thoughtworks/gauge/markdownPreview/FormatterTest.java`
- Target behavior:
  - When Spectacle is unavailable and the VS Code extension writes fallback preview HTML, table blocks follow the same body formatting as the IntelliJ formatter.

## RED

- Command: `node --test --test-name-pattern "previewGaugeDocument formats fallback table blocks like IntelliJ preview" test/preview.test.js`
- Result: failed with 1 failing test.
- Failure summary: fallback preview output normalized table row indentation but did not insert the blank line before each table block.

## Implementation

- Product files:
  - `src/preview.js`
- Summary:
  - Replaced the simple line-level table indentation rewrite with block-aware fallback preview formatting.
  - Collapsed existing blank lines before a table block to one blank line and normalized every table row to one leading tab before HTML escaping.

## GREEN

- Command: `node --test --test-name-pattern "previewGaugeDocument formats fallback table blocks like IntelliJ preview" test/preview.test.js`
- Result: passed with 1 selected test.

## Broader Check

- Command: `node --test test/preview.test.js`
- Result: passed with 11 tests.
- Command: `npm run check`
- Result: passed. Unit tests passed 846, LSP tests passed 32, VS Code extension tests passed 47, and packaging completed.
