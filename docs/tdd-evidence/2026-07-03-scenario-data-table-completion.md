# Scenario Data Table Completion TDD Evidence

## Scope

- Parity item: source-only follow-up from the IntelliJ and Gauge runtime language/editor audit.
- Reference behavior: Gauge runtime parses scenario data tables as scenario-scoped data, so step dynamic arguments in that scenario should be able to use those table headers.
- Reference paths:
  - `references/gauge/parser/lex_test.go`
  - `references/gauge/parser/convert.go`
- Target behavior: dynamic argument completion offers scenario data table headers for steps in the same scenario, without changing concept completion or spec-level table completion.

## RED

- Test path: `test/dynamicArgumentCompletion.test.js`
- Command: `node --test --test-name-pattern "scenario data table headers" test/dynamicArgumentCompletion.test.js`
- Result: failed with 1 failing test.
- Failure summary: completion returned no labels for a scenario that had only a scenario data table, instead of returning `user` and `role`.

## Implementation

- Production file: `src/dynamicArgumentCompletion.js`
- Summary:
  - Added scenario-scoped data table header collection based on the nearest previous scenario heading.
  - Merged scenario headers with existing spec data table headers for spec dynamic argument completion.

## GREEN

- Command: `node --test --test-name-pattern "scenario data table headers" test/dynamicArgumentCompletion.test.js`
- Result: passed with 1 selected test.
- Command: `node --test test/dynamicArgumentCompletion.test.js`
- Result: passed with 45 tests.

## Broader Check

- Command: `npm run check`
- Result: passed.
- Output summary: `test:unit` passed with 799 tests, `test:lsp` passed with 32 tests, `test:vscode` passed with 44 tests, and package dry-run completed.
