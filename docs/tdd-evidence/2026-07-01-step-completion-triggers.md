# Step completion triggers

Reference behavior:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/autocomplete/StepCompletionContributor.java`
  registers basic completion for Gauge step tokens.
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/autocomplete/StepCompletionProvider.java`
  then provides step completions for the step text prefix.

Target behavior:
- The VS Code completion provider is triggered when a user starts a Gauge step
  with `*` or types the following step-text space.
- Dynamic and static argument trigger characters `<` and `"` remain registered.
- The existing completion provider filters continue to limit suggestions to
  Gauge and Markdown Gauge specification contexts.

RED:
- `node --test test/extension.test.js --test-name-pattern "dynamic argument completions"`
- Result: failed before implementation because the registered trigger
  characters were only `<` and `"`.

GREEN:
- `node --test test/extension.test.js --test-name-pattern "dynamic argument completions"`
- `node --test test/dynamicArgumentCompletion.test.js`
- Result: passed after implementation with 28 activation tests and 43
  completion provider tests passing.
