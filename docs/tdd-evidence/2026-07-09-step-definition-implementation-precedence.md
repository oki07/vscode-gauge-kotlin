# Step Definition Implementation Precedence

## Reference

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/StepUtil.java`

IntelliJ Gauge resolves a spec step to a Step implementation method before falling back to matching concept headings. Definition navigation should prefer Gauge project Step implementations when both an implementation and a concept match the same step text.

## RED

Command:

```sh
node --test --test-name-pattern "prefers Gauge project Step functions over concept headings|resolves spec steps to concept headings" test/stepDefinitionProvider.test.js
```

Result: failed with 1 passing test and 1 failing test.

Failing coverage:

- `GaugeStepDefinitionProvider prefers Gauge project Step functions over concept headings`

Observed failure:

- Expected definition URI `/workspace/gauge/src/test/kotlin/steps/PaymentSteps.kt`.
- Actual definition URI `/workspace/gauge/specs/concepts/payment.cpt`.

## GREEN

Command:

```sh
node --test --test-name-pattern "prefers Gauge project Step functions over concept headings|resolves spec steps to concept headings" test/stepDefinitionProvider.test.js
```

Result: passed with 2 passing tests.

Broader targeted command:

```sh
node --test test/stepDefinitionProvider.test.js
```

Result: passed with 35 passing tests.

Implementation:

- Definition navigation now searches Gauge project Step implementation documents before concept headings.
- Concept headings remain the fallback when no project Step implementation matches.
- External workspace Step implementations remain the final fallback after project-local definitions and concepts.
