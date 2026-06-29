# Indented Step Quick Fix

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/annotator/StepAnnotator.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/psi/SpecPsiImplUtil.java`
- Existing VS Code parser parity in `src/stepDiagnostics.js`, `src/dynamicArgumentCompletion.js`, and `src/argumentCodeActions.js`

## RED

- Command: `node --test test/stepCodeActions.test.js --test-name-pattern "ignores indented step markers"`
- Result: failed, 5 passed and 1 failed.
- Failure: an indented `* Draft pay with <amount>` line still produced a `Create step implementation` quick fix and Kotlin stub.

## GREEN

- Command: `node --test test/stepCodeActions.test.js --test-name-pattern "ignores indented step markers"`
- Result: passed, 6 tests.
- Command: `node --test test/stepCodeActions.test.js test/argumentCodeActions.test.js test/stepDiagnostics.test.js`
- Result: passed, 224 tests.

## Broader Check

- Command: `npm run check`
- Result: passed, including 719 unit tests, 27 LSP tests, 39 VS Code and manifest tests, and packaging.

## Change

- Restricted undefined-step quick fix extraction to `*` markers at column 0.
- Kept quick-fix behavior aligned with diagnostics, argument actions, completion, and the IntelliJ parser model where indented `*` lines are plain text rather than Gauge steps.
