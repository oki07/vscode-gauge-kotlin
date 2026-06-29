# Concept Heading References

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/psi/ConceptPsiImplUtil.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/findUsages/StepCollector.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/findUsages/ReferenceSearch.java`

## RED

- Command: `node --test test/gaugeReference.test.js --test-name-pattern "concept heading cursor"`
- Result: failed, 22 passed and 1 failed.
- Failure: local references from a `.cpt` concept heading cursor returned `[]` when no Gauge LSP client supplied references.

## GREEN

- Command: `node --test test/gaugeReference.test.js --test-name-pattern "concept heading cursor"`
- Result: passed, 23 tests.
- Command: `node --test test/gaugeReference.test.js test/stepDefinitionProvider.test.js test/renameProvider.test.js`
- Result: passed, 70 tests.

## Broader Check

- Command: `npm run check`
- Result: passed, including 718 unit tests, 27 LSP tests, 39 VS Code and manifest tests, and packaging.

## Change

- Added local concept heading step-value extraction for `.cpt` reference requests.
- Reused existing local Gauge reference fallback so concept heading references include matching spec steps and concept usages when LSP references are unavailable.
