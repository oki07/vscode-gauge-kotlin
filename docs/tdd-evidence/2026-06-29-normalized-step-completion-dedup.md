# Normalized Step Completion Deduplication

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/autocomplete/StepCompletionProvider.java`

## RED

- Command: `node --test test/dynamicArgumentCompletion.test.js --test-name-pattern "deduplicates normalized"`
- Result: failed, 40 passed and 1 failed.
- Failure reason: completion returned both `Pay with <amount>` and `Pay with <value>` even though they normalize to the same Gauge step template.

## GREEN

- Command: `node --test test/dynamicArgumentCompletion.test.js --test-name-pattern "deduplicates normalized"`
- Result: passed, 41 tests.

- Command: `node --test test/dynamicArgumentCompletion.test.js`
- Result: passed, 41 tests.

## Broader Checks

- Command: `npm run check`
- Result: passed, 683 unit tests, 26 LSP tests, 36 VS Code surface tests, and VSIX packaging.

## Change

- Step completion entries and merged Gauge LSP completions now deduplicate by normalized Gauge step template instead of exact display label.
