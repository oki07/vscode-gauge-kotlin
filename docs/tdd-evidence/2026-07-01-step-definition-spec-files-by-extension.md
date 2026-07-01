# Step Definition Spec Files By Extension

## Scope

Gauge step definition navigation must work for `.spec` files even when VS Code opens the document as plaintext. The extension should register the definition provider by `.spec` file selector and the provider should treat `.spec` paths as Gauge step sources while keeping project-root filtering in place.

## Reference

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileTypeFactory.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/reference/StepReference.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/StepUtil.java`
- `references/gauge/api/lang/capabilities.go`
- `references/gauge/api/lang/definition.go`

## RED

- Command: `node --test --test-name-pattern "spec files by extension to Kotlin Step functions|activation registers Kotlin step definitions" test/stepDefinitionProvider.test.js test/extension.test.js`
- Result: failed with 2 failing tests. Plaintext `.spec` documents resolved 0 definitions, and activation registered no `**/*.spec` definition selector.

## GREEN

- Command: `node --test --test-name-pattern "spec files by extension to Kotlin Step functions|activation registers Kotlin step definitions" test/stepDefinitionProvider.test.js test/extension.test.js`
- Result: passed with 2 selected tests.

## Implementation

- Added `.spec` path recognition to `GaugeStepDefinitionProvider` source-document detection.
- Registered the existing `SPEC_FILE_SELECTOR` with the definition provider.
- Added provider and activation regression coverage.

## Broader Check

- Command: `node --test test/stepDefinitionProvider.test.js test/extension.test.js`
- Result: passed with 59 tests.
- Command: `npm run check`
- Result: passed. Unit tests passed with 780 tests, LSP tests passed with 28 tests, VS Code tests passed with 41 tests, and packaging completed with 468 VSIX files.
