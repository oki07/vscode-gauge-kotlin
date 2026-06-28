# Kotlin Reference CodeLens

Reference source:
- `references/gauge-vscode/src/gaugeWorkspace.ts`
- `references/gauge-vscode/src/gaugeReference.ts`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/findUsages/CustomFindUsagesHandlerFactory.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/findUsages/ReferenceSearch.java`

Target behavior:
- Kotlin Gauge step implementation files expose a reference CodeLens on `@Step` declarations.
- The CodeLens invokes the Gauge reference command with the implementation URI, declaration position, and step alias.
- The provider is registered for Kotlin documents and `.kt` files so plaintext Kotlin files are covered when no Kotlin extension is installed.
- `gauge.codeLenses.reference=false` suppresses implementation reference CodeLens entries.

RED:
- Command: `node --test test/codeLensProvider.test.js test/extension.test.js`
- Result: failed before implementation.
- Failing tests:
  - `GaugeCodeLensProvider adds reference lenses for Kotlin Step functions`
  - `activation registers Gauge run code lenses for Gauge documents`

GREEN:
- Command: `node --test test/codeLensProvider.test.js test/extension.test.js`
- Result: passed, 30 tests.

Broader checks:
- Command: `npm run check`
- Result: passed, 651 unit tests, 25 LSP tests, 30 VS Code surface tests, and VSIX packaging.
- Command: `git diff --check`
- Result: passed.
- Command: `../.codex/hooks/check-source-language.sh`
- Result: passed.
