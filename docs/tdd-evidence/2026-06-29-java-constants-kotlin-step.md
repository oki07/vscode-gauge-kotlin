# Java Constants In Kotlin Step Annotations

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/StepUtil.java`
- `references/gauge-vscode/src/features/definitionProvider.ts`

## RED

- Command: `node --test test/stepDefinitionProvider.test.js --test-name-pattern "imported Java constants"`
- Result: failed.
- Failure: definition lookup returned 0 locations for a Kotlin `@Step(JavaStepText.LOGIN)` alias backed by a Java `public static final String`.
- Command: `node --test test/stepDiagnostics.test.js --test-name-pattern "Java constants in Kotlin Step annotations"`
- Result: failed.
- Failure: a Gauge spec step implemented by Kotlin `@Step(JavaStepText.PAYMENT)` was reported as `Undefined Step`.

## GREEN

- Command: `node --test test/stepDefinitionProvider.test.js --test-name-pattern "imported Java constants"`
- Result: passed, 24 tests.
- Command: `node --test test/stepDiagnostics.test.js --test-name-pattern "Java constants in Kotlin Step annotations"`
- Result: passed, 200 tests.
- Command: `node --test test/stepDefinitionProvider.test.js test/stepDiagnostics.test.js`
- Result: passed, 224 tests.
- Command: `node --test test/renameProvider.test.js test/gaugeReference.test.js test/codeLensProvider.test.js`
- Result: passed, 45 tests.

## Broader Check

- Command: `git diff --check`
- Result: passed.
- Command: `npm run check`
- Result: passed, including 695 unit tests, 27 LSP tests, 36 VS Code and manifest tests, and packaging.

## Change

- Collected Java `public static final String` constants from workspace Java documents.
- Exposed Java constants to Kotlin step annotation resolution through named and wildcard imports.
- Passed Java implementation documents into workspace constant collection for definition lookup and undefined-step diagnostics.
