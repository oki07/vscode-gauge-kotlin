# Legacy Table Snippets TDD Evidence

## Scope

- Parity item: IntelliJ Gauge live templates for table snippets.
- Reference behavior:
  - IntelliJ Gauge contributes `table:1` through `table:6` live templates.
  - The IntelliJ table templates insert a header row and two value rows without a Markdown separator row.
- Reference paths:
  - `references/intellij-gauge-plugin/resources/liveTemplates/gaugeTemplates.xml`
- Target behavior:
  - VS Code snippets keep the existing Markdown table snippets.
  - VS Code snippets also expose IntelliJ-compatible `table:1` through `table:6` snippets without separator rows.

## RED

- Command: `node --test --test-name-pattern "core Gauge VS Code surface" test/manifest.test.js`
- Result: failed with 1 failing test.
- Failure summary: the snippets file exposed only one `table:1` through `table:6` set and did not include the IntelliJ-compatible legacy table snippet bodies.

## Implementation

- Product files:
  - `snippets/gauge.json`
- Summary:
  - Added `Legacy Table with one column` through `Legacy Table with six columns`.
  - Reused the IntelliJ `table:1` through `table:6` prefixes.
  - Preserved the existing Markdown table snippets with separator rows.

## GREEN

- Command: `node --test --test-name-pattern "core Gauge VS Code surface" test/manifest.test.js`
- Result: passed with 1 selected test.

## Broader Check

- Command: `npm run check`
- Result: passed. Unit tests passed 805, LSP tests passed 32, VS Code extension tests passed 45, and packaging completed.
