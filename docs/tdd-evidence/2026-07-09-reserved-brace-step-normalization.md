# Reserved Brace Step Normalization

## Reference Source

- `references/gauge/parser/stepParser.go`
- `references/gauge/parser/stepParser_test.go`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/psi/SpecPsiImplUtil.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/StepUtil.java`

## RED

- Command: `node --test --test-name-pattern "reserved brace parsing|resolves spec steps to Kotlin Step functions" test/stepDefinitionProvider.test.js`
- Result: failed because `normalizeStepTemplate("Step with \\{braces\\}")` returned `Step with \\{braces\\}` instead of the Gauge parser value `Step with {braces}`.

## GREEN

- Command: `node --test --test-name-pattern "reserved brace parsing|resolves spec steps to Kotlin Step functions" test/stepDefinitionProvider.test.js`
- Result: passed 2 tests.

## Broader Check

- Command: `node --test test/stepDefinitionProvider.test.js test/stepDiagnostics.test.js test/gaugeReference.test.js test/renameProvider.test.js test/codeLensProvider.test.js test/dynamicArgumentCompletion.test.js`
- Result: passed 413 tests.
