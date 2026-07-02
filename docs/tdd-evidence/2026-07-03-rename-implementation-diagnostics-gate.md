# Rename Implementation Diagnostics Gate TDD Evidence

## Scope

- Parity item: source-only follow-up from the IntelliJ action/refactoring audit.
- Reference behavior: IntelliJ compiles the project before Gauge refactoring and rejects refactor when compile errors are present.
- Reference path:
  - `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/rename/GaugeRefactorHandler.java`
- Target behavior: VS Code rename preflight rejects refactoring when same-project Kotlin or Java implementation diagnostics contain Error severity.

## RED

- Test path: `test/renameProvider.test.js`
- Command: `node --test --test-name-pattern "implementation diagnostics report compile errors" test/renameProvider.test.js`
- Result: failed with 1 failing test.
- Failure summary: rename completed instead of rejecting when the Kotlin implementation document had an Error diagnostic.

## Implementation

- Production file: `src/renameProvider.js`
- Summary:
  - Added a rename preflight diagnostics gate using `languages.getDiagnostics`.
  - Limited the gate to `.kt`, `.kts`, and `.java` implementation diagnostics in the same Gauge project.
  - Kept Gauge validate preflight after the implementation diagnostics gate.

## GREEN

- Command: `node --test --test-name-pattern "implementation diagnostics report compile errors" test/renameProvider.test.js`
- Result: passed with 1 selected test.
- Command: `node --test test/renameProvider.test.js`
- Result: passed with 25 tests.

## Broader Check

- Command: `npm run check`
- Result: passed. Unit tests passed 802, LSP tests passed 32, VS Code extension tests passed 45, and packaging completed.
