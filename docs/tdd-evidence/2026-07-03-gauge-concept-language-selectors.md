# Gauge Concept Language Selectors TDD Evidence

## Scope

- Parity item: First-class `gauge-concept` editor language coverage after splitting `.cpt` files from the `gauge` TextMate language.
- Reference behavior:
  - IntelliJ has separate Gauge spec and concept file types.
  - gauge-vscode registers Gauge editor commands and providers for Gauge files through language/file selectors.
- Reference paths:
  - `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/ConceptFileType.java`
  - `references/gauge-vscode/src/extension.ts`
  - `references/gauge-vscode/src/gaugeWorkspace.ts`
- Target behavior:
  - Commands, keybindings, local providers, and Gauge LSP clients recognize both `gauge` and `gauge-concept` editor language ids.
  - Existing `.spec`, `.cpt`, Markdown, Kotlin, and Java file selector coverage is preserved.

## RED

- Command: `node --test --test-name-pattern "core Gauge VS Code surface|concept definition selectors|explicit spec and concept reference selectors|plaintext Kotlin file rename selector|starts Gauge LSP clients for workspace projects" test/manifest.test.js test/stepDefinitionProvider.test.js test/gaugeReference.test.js test/renameProvider.test.js test/gaugeWorkspace.test.js`
- Result: failed with 5 failing tests.
- Failure summary: manifest editor conditions, reference provider selectors, rename provider selectors, step definition selectors, and Gauge LSP `documentSelector` did not include `gauge-concept`.

## Implementation

- Product files:
  - `package.json`
  - `src/extension.js`
  - `src/gaugeReference.js`
  - `src/gaugeWorkspace.js`
  - `src/renameProvider.js`
  - `src/stepDefinitionProvider.js`
- Summary:
  - Added `gauge-concept` to command/keybinding `when` clauses for Gauge editor contexts.
  - Added `gauge-concept` selectors to local Gauge provider registration and fallback registration paths.
  - Added `gauge-concept` to Gauge LSP `documentSelector` entries and active document detection.
  - Preserved `.spec`, `.cpt`, Markdown, Kotlin, and Java selector coverage.

## GREEN

- Command: `node --test --test-name-pattern "core Gauge VS Code surface|concept definition selectors|explicit spec and concept reference selectors|plaintext Kotlin file rename selector|starts Gauge LSP clients for workspace projects" test/manifest.test.js test/stepDefinitionProvider.test.js test/gaugeReference.test.js test/renameProvider.test.js test/gaugeWorkspace.test.js`
- Result: passed with 5 selected tests.

## Broader Check

- Command: `node --test test/manifest.test.js test/extension.test.js test/gaugeReference.test.js test/renameProvider.test.js test/stepDefinitionProvider.test.js test/gaugeWorkspace.test.js`
- Result: passed with 164 tests.
- Command: `npm run check`
- Result: passed. Unit tests passed 845, LSP tests passed 32, VS Code extension tests passed 47, and packaging completed.
