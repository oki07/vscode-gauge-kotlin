# Java Constant Step Aliases

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/StepUtil.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/findUsages/StepCollector.java`

## RED

- Command: `node --test test/stepDefinitionProvider.test.js --test-name-pattern "imported Java constants"`
- Result: failed.
- Failure: definition lookup returned 0 locations for Java `@Step(JavaStepText.LOGIN)`.
- Command: `node --test test/stepDiagnostics.test.js --test-name-pattern "Java constants in Java Step annotations|Java constant Step parameter mismatches"`
- Result: failed.
- Failure: Java constant-backed step aliases were not used for undefined-step matching or Java implementation parameter mismatch diagnostics.

## GREEN

- Command: `node --test test/stepDefinitionProvider.test.js --test-name-pattern "imported Java constants"`
- Result: passed, 25 tests.
- Command: `node --test test/stepDiagnostics.test.js --test-name-pattern "Java constants in Java Step annotations|Java constant Step parameter mismatches"`
- Result: passed, 202 tests.
- Command: `node --test test/stepDefinitionProvider.test.js test/stepDiagnostics.test.js`
- Result: passed, 227 tests.
- Command: `node --test test/dynamicArgumentCompletion.test.js test/codeLensProvider.test.js test/gaugeReference.test.js test/renameProvider.test.js`
- Result: passed, 88 tests.

## Broader Check

- Command: `git diff --check`
- Result: passed.
- Command: `npm run check`
- Result: passed, including 700 unit tests, 27 LSP tests, 36 VS Code and manifest tests, and packaging.

## Change

- Evaluated Java `@Step` annotation string expressions through Java `static final String` constants.
- Supported Java class imports, package wildcard imports, static named imports, and static wildcard imports for step constants.
- Passed workspace constants to Java step implementations in definition, diagnostics, completion, CodeLens, reference, and rename flows.
