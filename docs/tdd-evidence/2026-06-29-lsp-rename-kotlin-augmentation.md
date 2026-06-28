# LSP Rename Kotlin Augmentation

Reference source:
- `references/gauge-vscode/src/gaugeReference.ts`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/rename/CustomRenameHandler.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/rename/GaugeRefactorHandler.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/findUsages/ReferenceSearch.java`

Target behavior:
- Gauge step rename keeps Kotlin `@Step` annotation aliases in sync even when the Gauge language server returns only Gauge file edits.
- Existing language server edits are preserved.
- Kotlin annotation edits are not duplicated when the language server already returned the same literal range.

RED:
- Command: `node --test test/renameProvider.test.js`
- Result: failed before implementation.
- Failing test:
  - `GaugeRenameProvider augments language server Gauge renames with Kotlin Step annotations`

GREEN:
- Command: `node --test test/renameProvider.test.js`
- Result: passed, 8 tests.

Broader checks:
- Command: `npm run check`
- Result: passed, 652 unit tests, 25 LSP tests, 30 VS Code surface tests, and VSIX packaging.
- Command: `git diff --check`
- Result: passed.
- Command: `../.codex/hooks/check-source-language.sh`
- Result: passed.
