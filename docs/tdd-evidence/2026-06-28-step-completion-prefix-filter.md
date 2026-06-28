# Step completion prefix filter

Parity item: SRC-ED-001

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/autocomplete/GaugePrefixMatcher.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/autocomplete/StepCompletionProvider.java`

Behavior:
- Step completion should keep a candidate visible when the typed prefix already contains a static argument, such as `"Alice"`, for a Gauge step alias that declares a dynamic placeholder, such as `<user>`.
- The inserted snippet should preserve the typed static argument as the first placeholder value.

RED:
- Command: `node --test --test-name-pattern "keeps filled static args" test/dynamicArgumentCompletion.test.js`
- Result: failed 1 of 1. `filterText` was `Log in as <user>` instead of `Log in as "Alice"`.

GREEN:
- Command: `node --test --test-name-pattern "keeps filled static args" test/dynamicArgumentCompletion.test.js`
- Result: passed 1 of 1.

Related:
- Command: `node --test test/dynamicArgumentCompletion.test.js test/stepDefinitionProvider.test.js test/extension.test.js`
- Result: passed 75 of 75.

Broad:
- Command: `npm run check`
- Result: passed. Unit 596 of 596, LSP 22 of 22, VS Code 25 of 25, package succeeded.
