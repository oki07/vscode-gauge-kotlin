# LSP Gauge File Selectors TDD Evidence

## Scope

- Parity item: Gauge LSP attachment for Gauge files opened by extension before file associations apply.
- Reference behavior:
  - IntelliJ treats `.spec` and `.cpt` as Gauge file types by extension.
  - gauge-vscode starts Gauge LSP services for Gauge projects and depends on Gauge file associations for editor documents.
- Reference paths:
  - `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileType.java`
  - `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/ConceptFileType.java`
  - `references/gauge-vscode/src/gaugeWorkspace.ts`
- Target behavior:
  - The VS Code language client attaches to `.spec` and `.cpt` files even when VS Code has not assigned the `gauge` language id yet.
  - Kotlin and Java project LSP selectors keep implementation-language selectors while also including Gauge file extension selectors.

## RED

- Command: `node --test --test-name-pattern "GaugeWorkspace starts Gauge LSP clients for workspace projects|GaugeWorkspace generates Java config for mixed-case Java plugins|GaugeWorkspace starts a client for the active Markdown Gauge specification" test/gaugeWorkspace.test.js`
- Result: failed with 3 failing tests.
- Failure summary: LSP `documentSelector` did not include `.spec` or `.cpt` file extension selectors.

## Implementation

- Product files:
  - `src/gaugeWorkspace.js`
- Summary:
  - Added file-extension selectors for `${project.root()}/**/*.spec` and `${project.root()}/**/*.cpt` to Gauge language client options.
  - Preserved existing Markdown, Kotlin, and Java selectors.

## GREEN

- Command: `node --test --test-name-pattern "GaugeWorkspace starts Gauge LSP clients for workspace projects|GaugeWorkspace generates Java config for mixed-case Java plugins|GaugeWorkspace starts a client for the active Markdown Gauge specification" test/gaugeWorkspace.test.js`
- Result: passed with 3 selected tests.

## Broader Check

- Command: `node --test test/gaugeWorkspace.test.js`
- Result: passed with 28 tests.
- Command: `npm run check`
- Result: passed. Unit tests passed 809, LSP tests passed 32, VS Code extension tests passed 46, and packaging completed.
