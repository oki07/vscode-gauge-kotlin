# Step Definition Project Root Scope

## Reference Source

- `references/gauge-vscode/src/gaugeClients.ts`
- `references/gauge-vscode/src/gaugeWorkspace.ts`
- `references/gauge-vscode/src/gaugeReference.ts`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/StepUtil.java`

## RED

- Command: `node --test test/stepDefinitionProvider.test.js --test-name-pattern "another Gauge project"`
- Result: failed.
- Failure: definition lookup from project A returned a Kotlin `@Step` definition from project B.
- Command: `node --test test/stepDefinitionProvider.test.js --test-name-pattern "another Gauge project"`
- Result: failed after adding the concept case.
- Failure: definition lookup from project A returned a concept heading from project B.

## GREEN

- Command: `node --test test/stepDefinitionProvider.test.js --test-name-pattern "another Gauge project"`
- Result: passed, 27 tests.
- Command: `node --test test/stepDefinitionProvider.test.js`
- Result: passed, 27 tests.
- Command: `node --test test/stepDefinitionProvider.test.js test/stepDiagnostics.test.js test/gaugeReference.test.js test/dynamicArgumentCompletion.test.js`
- Result: passed, 291 tests.

## Broader Check

- Command: `npm run check`
- Result: passed, including 706 unit tests, 27 LSP tests, 37 VS Code and manifest tests, and packaging.

## Change

- Scoped step implementation definition candidates to the active Gauge project root.
- Scoped concept definition candidates to the active Gauge project root.
- Preserved external fallback for files outside any Gauge project while excluding candidates from a different Gauge root.
