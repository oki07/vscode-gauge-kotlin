# Extract Concept Spec Extension TDD Evidence

## Scope

- Parity item: Extract Concept entry points for Gauge specification files opened by `.spec` extension.
- Reference behavior:
  - IntelliJ Extract Concept works on Gauge specification PSI files.
  - The product already adapts Gauge specification files by extension across editor features.
- Reference paths:
  - `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/extract/ExtractConceptHandler.java`
  - `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/extract/stepBuilder/SpecStepsBuilder.java`
  - `references/gauge/conceptExtractor/conceptExtractor.go`
- Target behavior:
  - `gauge.extract.concept` extracts selected steps from a `.spec` file even when VS Code reports the document as plaintext.
  - Extract, format, and preview command/menu/keybinding surfaces are visible for `.spec` resources because the runtime providers already support those entry points.

## RED

- Command: `node --test --test-name-pattern "spec files by extension" test/extractConcept.test.js`
- Result: failed with 1 failing test.
- Failure summary: the command reported `Cannot find Gauge document for extract to concept.` for a plaintext `.spec` file.
- Command: `node --test --test-name-pattern "core Gauge VS Code surface" test/manifest.test.js`
- Result: failed with 1 failing test.
- Failure summary: manifest conditions for extract, format, and preview were still limited to Gauge language documents and Markdown `.md` specs.

## Implementation

- Production files:
  - `src/extractConcept.js`
  - `package.json`
- Summary:
  - Added `.spec` extension recognition to Extract Concept document and selection validation.
  - Added `.spec` resource visibility to extract, format, and preview menu/keybinding conditions.

## GREEN

- Command: `node --test --test-name-pattern "spec files by extension" test/extractConcept.test.js`
- Result: passed with 1 selected test.
- Command: `node --test --test-name-pattern "core Gauge VS Code surface" test/manifest.test.js`
- Result: passed with 1 selected test.
- Command: `node --test test/extractConcept.test.js test/manifest.test.js test/preview.test.js test/formatProvider.test.js`
- Result: passed with 60 tests.

## Broader Check

- Command: `npm run check`
- Result: passed. Unit tests passed 803, LSP tests passed 32, VS Code extension tests passed 45, and packaging completed.
