# Concept Workspace Symbols TDD Evidence

## Scope

Workspace symbol lookup should include Gauge concept files so reusable concept
headings are discoverable from "Go to Symbol in Workspace".

## Source-only reference context

- `references/intellij-gauge-plugin/resources/META-INF/plugin.xml` registers
  Concept as a first-class Gauge language surface.
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/findUsages/StepCollector.java`
  includes concept files alongside spec files during project-wide collection.
- The target provider already supports document symbols for open `.cpt` files,
  but workspace scans only opened `**/*.spec` and `**/*.md` candidates.

## RED

Command:

```sh
node --test --test-name-pattern "concept workspace symbols" test/documentSymbolProvider.test.js
```

Result:

- Passed: 0
- Failed: 1

Failure summary:

- The workspace symbol scan searched `**/*.spec` and `**/*.md`, but did not
  search `**/*.cpt`, so concept headings were omitted.

## GREEN

Command:

```sh
node --test --test-name-pattern "concept workspace symbols" test/documentSymbolProvider.test.js
```

Result:

- Passed: 1
- Failed: 0

Focused check:

```sh
node --test test/documentSymbolProvider.test.js
```

Result:

- Passed: 7
- Failed: 0

## Implementation Notes

- Added `**/*.cpt` to the workspace symbol scan patterns.
- Reused existing `.cpt` document symbol parsing so concept headings remain in
  the same symbol grouping as Gauge hash headings.
