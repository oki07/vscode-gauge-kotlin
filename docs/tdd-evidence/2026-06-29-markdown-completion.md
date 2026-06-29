# Markdown Completion

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileTypeFactory.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/autocomplete/StepCompletionContributor.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/autocomplete/StepCompletionProvider.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/autocomplete/DynamicArgCompletionProvider.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/autocomplete/StaticArgCompletionProvider.java`

## RED

- Command: `node --test test/dynamicArgumentCompletion.test.js --test-name-pattern "Markdown Gauge specs|Markdown files outside Gauge projects"`
- Result: failed, 38 passed and 2 failed.
- Failure reason: Markdown `.md` Gauge specs did not receive local Kotlin step completions, while non-Gauge Markdown files still received table header completions.

- Command: `node --test test/extension.test.js --test-name-pattern "dynamic argument completions"`
- Result: failed, 24 passed and 1 failed.
- Failure reason: completion registration only targeted `{ language: "gauge" }`.

## GREEN

- Command: `node --test test/dynamicArgumentCompletion.test.js --test-name-pattern "Markdown Gauge specs|Markdown files outside Gauge projects"`
- Result: passed, 40 tests.

- Command: `node --test test/extension.test.js --test-name-pattern "dynamic argument completions"`
- Result: passed, 25 tests.

- Command: `node --test test/dynamicArgumentCompletion.test.js`
- Result: passed, 40 tests.

## Broader Checks

- Command: `npm run check`
- Result: passed, 681 unit tests, 26 LSP tests, 36 VS Code surface tests, and VSIX packaging.

## Change

- Step, dynamic argument, and static argument completions are registered for Markdown `.md` Gauge specifications.
- Markdown completion is gated by Gauge project resolution so ordinary Markdown files do not receive Gauge completions.
