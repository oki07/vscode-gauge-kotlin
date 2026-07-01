# Rename Spec Files By Extension

## Scope

Gauge step rename must work for `.spec` files even when VS Code opens the document as plaintext. The rename provider should register by `.spec` file selector, identify `.spec` paths as Gauge documents, and update matching Kotlin `@Step` annotations through the existing local rename path.

## Reference

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileTypeFactory.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/rename/GaugeRefactorHandler.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/StepUtil.java`
- `references/gauge/api/lang/rename.go`

## RED

- Command: `node --test --test-name-pattern "spec files by extension and Kotlin Step annotations|plaintext Kotlin file rename selector|activation starts Gauge workspace services for Gauge projects" test/renameProvider.test.js test/extension.test.js`
- Result: failed with 3 failing tests. Plaintext `.spec` rename returned no workspace edit, provider registration had no `**/*.spec` selector, and activation fallback registration had no `**/*.spec` selector.

## GREEN

- Command: `node --test --test-name-pattern "spec files by extension and Kotlin Step annotations|plaintext Kotlin file rename selector|activation starts Gauge workspace services for Gauge projects" test/renameProvider.test.js test/extension.test.js`
- Result: passed with 3 selected tests.

## Implementation

- Added `.spec` path recognition to `GaugeRenameProvider` Gauge document detection.
- Registered `**/*.spec` with `GaugeRenameProvider.register()`.
- Registered the existing `SPEC_FILE_SELECTOR` in the activation fallback rename registration.
- Added provider, rename behavior, and activation regression coverage.

## Broader Check

- Command: `node --test test/renameProvider.test.js test/extension.test.js`
- Result: passed with 53 tests.
- Command: `npm run check`
- Result: passed. Unit tests passed with 781 tests, LSP tests passed with 28 tests, VS Code tests passed with 41 tests, and packaging completed with 468 VSIX files.
