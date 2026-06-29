# Markdown Step References

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileTypeFactory.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/findUsages/StepFindUsagesHandler.java`

## RED

- Command: `node --test test/gaugeReference.test.js --test-name-pattern "Markdown Gauge references|Markdown Gauge spec steps"`
- Result: failed, 19 passed and 2 failed.
- Failure reason: local reference search ignored `markdown` language `.md` Gauge specs.

- Command: `node --test test/extension.test.js --test-name-pattern "registers Gauge reference providers"`
- Result: failed, 24 passed and 1 failed.
- Failure reason: the reference provider selector omitted Markdown Gauge specs.

## GREEN

- Command: `node --test test/gaugeReference.test.js --test-name-pattern "Markdown Gauge references|Markdown Gauge spec steps"`
- Result: passed, 21 tests.

- Command: `node --test test/extension.test.js --test-name-pattern "registers Gauge reference providers"`
- Result: passed, 25 tests.

- Command: `node --test test/gaugeReference.test.js`
- Result: passed, 21 tests.

## Broader Checks

- Command: `npm run check`
- Result: passed, 687 unit tests, 26 LSP tests, 36 VS Code surface tests, and VSIX packaging.

## Change

- Reference lookup now treats file-backed `markdown` `.md` files as Gauge reference documents.
- Reference provider registration now includes Markdown Gauge specs.
