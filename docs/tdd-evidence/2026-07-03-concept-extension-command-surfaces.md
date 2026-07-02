# Concept Extension Command Surfaces TDD Evidence

## Scope

- Parity item: command, menu, and keybinding surfaces for Gauge concept files opened by `.cpt` extension.
- Reference behavior:
  - IntelliJ Gauge actions are available on concept files through Gauge PSI/file type support.
  - The product runtime already supports concept files by `.cpt` extension for preview, format, extract concept, and line comments.
- Reference paths:
  - `references/intellij-gauge-plugin/resources/META-INF/plugin.xml`
  - `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/extract/ExtractConceptHandler.java`
  - `vscode-gauge-kotlin/src/preview.js`
  - `vscode-gauge-kotlin/src/formatProvider.js`
  - `vscode-gauge-kotlin/src/extractConcept.js`
  - `vscode-gauge-kotlin/src/commentCommand.js`
- Target behavior:
  - Preview, extract concept, format, and toggle line comment surfaces are visible for `.cpt` resources.
  - The manifest surface matches the runtime providers that already accept concept files by extension.

## RED

- Command: `node --test --test-name-pattern "core Gauge VS Code surface" test/manifest.test.js`
- Result: failed with 1 failing test.
- Failure summary: manifest conditions for editor and command surfaces did not include `resourceExtname == .cpt`.

## Implementation

- Production files:
  - `package.json`
- Summary:
  - Added `.cpt` resource visibility to extract concept, format, preview, and toggle line comment command/menu/keybinding conditions.
  - Kept the existing Markdown `.md` Gauge-project surface intact.

## GREEN

- Command: `node --test --test-name-pattern "core Gauge VS Code surface" test/manifest.test.js`
- Result: passed with 1 selected test.
- Command: `node --test --test-name-pattern "concept files by extension|comments spec files by extension|comments concept files by extension" test/extractConcept.test.js test/formatProvider.test.js test/preview.test.js test/commentCommand.test.js`
- Result: passed with 5 selected tests.

## Broader Check

- Command: `npm run check`
- Result: passed. Unit tests passed 803, LSP tests passed 32, VS Code extension tests passed 45, and packaging completed.
