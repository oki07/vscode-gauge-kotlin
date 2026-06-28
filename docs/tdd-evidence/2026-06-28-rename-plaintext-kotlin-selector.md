# Rename Plaintext Kotlin Selector

Scope: LNG-010 source parity gap. Gauge rename support must be registered for `.kt` files even when VS Code opens them as plaintext before the Kotlin extension claims the document.

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/rename/CustomRenameHandler.java`
- Existing target fallback selector in `src/extension.js`
- Existing plaintext Kotlin handling in step definition and reference providers

Target files:
- `src/renameProvider.js`
- `test/renameProvider.test.js`

RED:
- Command: `node --test test/renameProvider.test.js`
- Result: failed, 2 passed and 1 failed.
- Failing test: `GaugeRenameProvider registers plaintext Kotlin file rename selector`.
- Failure: provider registration only used `gauge` and `kotlin` language selectors.

GREEN:
- Command: `node --test test/renameProvider.test.js`
- Result: passed, 3 tests passed.

Related checks:
- Command: `node --test test/renameProvider.test.js test/extension.test.js`
- Result: passed, 22 tests passed.
- Command: `npm run check`
- Result: passed.
- Unit tests: 582 passed.
- LSP tests: 20 passed.
- VS Code manifest/extension tests: 24 passed.
- Package step: passed.
