# Concept Step Diagnostics TDD Evidence

## Scope

- Parity item: IntelliJ `StepAnnotator` diagnostics for concept steps.
- Reference behavior:
  - IntelliJ annotates both `SpecStep` and `ConceptStep`.
  - Blank concept steps report `Step should not be blank`.
  - Undefined concept steps report `Undefined Step`.
- Reference paths:
  - `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/annotator/StepAnnotator.java`
- Target behavior:
  - VS Code step diagnostics treat `.cpt` files as Gauge step-source documents by extension.
  - Concept body steps receive the same blank and undefined diagnostics as specification steps.

## RED

- Command: `node --test --test-name-pattern "undefined concept steps by extension" test/stepDiagnostics.test.js`
- Result: failed with 1 failing test.
- Failure summary: a plaintext `.cpt` concept document returned no diagnostics for an undefined step or a blank step.

## Implementation

- Product files:
  - `src/stepDiagnostics.js`
- Summary:
  - Added `isGaugeStepSourceDocument` to classify specifications and concepts through one step-source diagnostic path.
  - Updated the diagnostics entry checks so `.cpt` documents by extension run the existing Gauge step diagnostics.

## GREEN

- Command: `node --test --test-name-pattern "undefined concept steps by extension" test/stepDiagnostics.test.js`
- Result: passed with 1 selected test.

## Broader Check

- Command: `node --test test/stepDiagnostics.test.js`
- Result: passed with 208 tests.
- Command: `npm run check`
- Result: passed. Unit tests passed 806, LSP tests passed 32, VS Code extension tests passed 45, and packaging completed.
