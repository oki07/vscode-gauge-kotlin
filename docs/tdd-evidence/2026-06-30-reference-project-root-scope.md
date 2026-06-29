# Reference Project Root Scope

## Reference Source

- `references/gauge-vscode/src/gaugeClients.ts`
- `references/gauge-vscode/src/gaugeReference.ts`
- `references/gauge-vscode/src/gaugeWorkspace.ts`

## RED

- Command: `node --test test/gaugeReference.test.js --test-name-pattern "another Gauge project"`
- Result: failed, 21 passed and 1 failed.
- Failure: local reference fallback for a project A Kotlin `@Step` returned matching project B spec references.
- Failure: local reference fallback for a project A Kotlin `@Step` returned matching project B concept heading references.

## GREEN

- Command: `node --test test/gaugeReference.test.js --test-name-pattern "another Gauge project"`
- Result: passed, 22 tests.
- Command: `node --test test/gaugeReference.test.js test/stepDefinitionProvider.test.js test/stepDiagnostics.test.js test/dynamicArgumentCompletion.test.js test/codeLensProvider.test.js`
- Result: passed, 306 tests.

## Broader Check

- Command: `npm run check`
- Result: passed, including 711 unit tests, 27 LSP tests, 37 VS Code and manifest tests, and packaging.

## Change

- Scoped local Gauge reference fallback to the active Gauge project root.
- Applied the scope to open workspace documents and unopened workspace files.
- Preserved external fallback behavior when no Gauge project root can be resolved.
