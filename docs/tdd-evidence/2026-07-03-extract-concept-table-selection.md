# Extract Concept Inline Table Selection TDD Evidence

## Scope

Extract Concept should treat a selection that starts inside an inline table as a
selection of the owning Gauge step and the whole table block.

## Source-only Reference Context

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/extract/stepBuilder/StepsBuilder.java`
  walks selected offsets and resolves each offset to the parent step PSI element.
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/extract/stepBuilder/SpecStepsBuilder.java`
  collects the selected step's inline table from the parent `SpecStepImpl`.
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/extract/stepBuilder/ConceptStepsBuilder.java`
  collects the selected concept step table from the parent `ConceptStepImpl`.

## RED

Command:

```sh
node --test --test-name-pattern "inline table selections" test/extractConcept.test.js
```

Result:

- Passed: 0
- Failed: 1

Failure summary:

- `buildExtractSelection expands inline table selections to their owning Gauge step`
  returned `undefined` because the selection start line was a table row rather
  than a Gauge step line.

## GREEN

Command:

```sh
node --test --test-name-pattern "inline table selections" test/extractConcept.test.js
```

Result:

- Passed: 1
- Failed: 0

Focused check:

```sh
node --test test/extractConcept.test.js
```

Result:

- Passed: 32
- Failed: 0

Broader check:

```sh
npm run check
```

Result:

- Unit tests passed: 852
- LSP tests passed: 32
- VS Code extension tests passed: 48
- Failed: 0
- Package completed.

## Implementation Notes

- Added table block boundary detection for inline table selections.
- When a table block is immediately owned by a Gauge step, extraction now
  expands the start line to that step and the end line to the whole table block.
- Table selections without an owning Gauge step remain invalid.
