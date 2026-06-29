# Undefined Diagnostics Project Root Scope

## Reference Source

- `references/gauge-vscode/src/gaugeClients.ts`
- `references/gauge-vscode/src/gaugeWorkspace.ts`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/StepUtil.java`

## RED

- Command: `node --test test/stepDiagnostics.test.js --test-name-pattern "another Gauge project"`
- Result: failed.
- Failure: a step implementation from project B suppressed the `Undefined Step` diagnostic for a project A spec.
- Failure: a concept heading from project B suppressed the `Undefined Step` diagnostic for a project A spec.

## GREEN

- Command: `node --test test/stepDiagnostics.test.js --test-name-pattern "another Gauge project"`
- Result: passed, 204 tests.
- Command: `node --test test/stepDiagnostics.test.js`
- Result: passed, 204 tests.
- Command: `node --test test/stepDefinitionProvider.test.js test/stepDiagnostics.test.js test/gaugeReference.test.js test/dynamicArgumentCompletion.test.js`
- Result: passed, 293 tests.

## Broader Check

- Command: `npm run check`
- Result: passed, including 708 unit tests, 27 LSP tests, 37 VS Code and manifest tests, and packaging.

## Change

- Scoped undefined-step implementation candidates to the active Gauge project root.
- Scoped undefined-step concept candidates to the active Gauge project root.
- Scoped workspace constant collection for step diagnostics to the active Gauge project root when a project factory is available.
