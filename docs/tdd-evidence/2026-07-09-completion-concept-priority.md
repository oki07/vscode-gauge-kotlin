# Completion Concept Priority

## Scope

- Parity target: Gauge step completion should keep concept headings ahead of implementation step aliases when both expose the same step text.
- Reference: `references/gauge/api/lang/completionStep.go` collects concept steps before used and implemented steps.

## RED

Command:

```sh
node --test --test-name-pattern "prefers concept headings over Step aliases" test/dynamicArgumentCompletion.test.js
```

Result:

- Failed 1 test.
- `GaugeDynamicArgumentCompletionProvider prefers concept headings over Step aliases` returned detail `step` for `Pay with <method>` instead of `concept`.

## GREEN

Command:

```sh
node --test --test-name-pattern "prefers concept headings over Step aliases" test/dynamicArgumentCompletion.test.js
```

Result:

- Passed 1 test.

## Broader Checks

Commands:

```sh
node --test test/dynamicArgumentCompletion.test.js
node --test test/dynamicArgumentCompletion.test.js test/stepDefinitionProvider.test.js test/gaugeReference.test.js test/extension.test.js
```

Results:

- Passed 64 tests.
- Passed 162 tests.
