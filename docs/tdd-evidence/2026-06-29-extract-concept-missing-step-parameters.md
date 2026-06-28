# Extract Concept Missing Step Parameters

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/extract/ExtractConceptInfoCollector.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/extract/ExtractConceptRequest.java`

Target behavior:
- Extract Concept keeps selected step dynamic arguments available in the generated concept heading and source concept usage.
- When the user omits a dynamic step parameter in the VS Code input box, the provider appends the missing parameter because VS Code `showInputBox` has no autocomplete equivalent to the IntelliJ dialog.
- Static argument parameterization remains limited to the generated concept definition and does not add generated static placeholders back to the source usage.

RED:
- Command: `node --test test/extractConcept.test.js`
- Result: failed before implementation.
- Failing test:
  - `ExtractConceptCommandProvider appends missing dynamic step parameters to concept usage`

GREEN:
- Command: `node --test test/extractConcept.test.js`
- Result: passed, 25 tests.

Broader checks:
- Command: `npm run check`
- Result: passed, 654 unit tests, 25 LSP tests, 31 VS Code surface tests, and VSIX packaging.
- Command: `git diff --check`
- Result: passed.
- Command: `../.codex/hooks/check-source-language.sh`
- Result: passed.
