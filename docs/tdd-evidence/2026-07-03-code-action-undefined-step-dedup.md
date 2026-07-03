# Undefined Step Code Action Deduplication TDD Evidence

## Scope

Undefined-step quick fixes should be produced by the step code action provider
only. The argument conversion provider should not also return those fixes,
because both providers are registered for the same Gauge document selectors.

## Source-only Reference Context

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/annotator/StepAnnotator.java`
  registers the undefined-step create-implementation fix from the step annotator.
- `vscode-gauge-kotlin/src/extension.js` registers both the argument code action
  provider and the step code action provider for Gauge document selectors.
- `vscode-gauge-kotlin/src/argumentCodeActions.js` previously delegated to
  `GaugeStepCodeActionProvider`, causing duplicate undefined-step quick fixes
  when both providers were active.

## RED

Command:

```sh
node --test --test-name-pattern "does not duplicate undefined-step fixes" test/argumentCodeActions.test.js
```

Result:

- Passed: 0
- Failed: 1

Failure summary:

- `GaugeArgumentCodeActionProvider does not duplicate undefined-step fixes`
  expected no undefined-step actions from the argument provider, but it returned
  two actions: create step implementation and create concept.

## GREEN

Command:

```sh
node --test --test-name-pattern "does not duplicate undefined-step fixes" test/argumentCodeActions.test.js
```

Result:

- Passed: 1
- Failed: 0

Focused check:

```sh
node --test test/argumentCodeActions.test.js test/stepCodeActions.test.js
```

Result:

- Passed: 30
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

- Removed `GaugeStepCodeActionProvider` delegation from
  `GaugeArgumentCodeActionProvider`.
- Kept argument conversion quick fixes unchanged.
- Kept undefined-step create-implementation and create-concept fixes in the
  separately registered step code action provider.
