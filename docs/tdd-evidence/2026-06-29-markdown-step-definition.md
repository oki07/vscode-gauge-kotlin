# Markdown Step Definition

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileTypeFactory.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/StepUtil.java`

## RED

- Command: `node --test test/stepDefinitionProvider.test.js --test-name-pattern "Markdown Gauge spec steps"`
- Result: failed, 22 passed and 1 failed.
- Failure reason: `provideDefinition` returned no definition for a `markdown` language `.md` Gauge step.

- Command: `node --test test/extension.test.js --test-name-pattern "registers Gauge step definitions"`
- Result: failed, 24 passed and 1 failed.
- Failure reason: activation registered the definition provider only for `{ language: "gauge" }`.

## GREEN

- Command: `node --test test/stepDefinitionProvider.test.js --test-name-pattern "Markdown Gauge spec steps"`
- Result: passed, 23 tests.

- Command: `node --test test/extension.test.js --test-name-pattern "registers Gauge step definitions"`
- Result: passed, 25 tests.

- Command: `node --test test/stepDefinitionProvider.test.js`
- Result: passed, 23 tests.

## Broader Checks

- Command: `npm run check`
- Result: passed, 685 unit tests, 26 LSP tests, 36 VS Code surface tests, and VSIX packaging.

## Change

- Step definition lookup now treats `markdown` language `.md` files as Gauge step source documents.
- The definition provider registers for both Gauge documents and file-backed Markdown Gauge specs.
