# Markdown Editor Providers

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileTypeFactory.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/autocomplete/ArgQuoteHandler.java`
- `references/gauge-vscode/src/semanticTokensProvider.ts`

## RED

- Command: `node --test test/extension.test.js --test-name-pattern "activation starts Gauge workspace services for Gauge projects"`
- Result: failed.
- Failure: the semantic token provider registration used only `{ language: "gauge" }` while the test expected the Markdown Gauge spec selector as well. The same activation expectation covers the argument code action selector.

## GREEN

- Command: `node --test test/extension.test.js --test-name-pattern "activation starts Gauge workspace services for Gauge projects"`
- Result: passed, 25 tests.
- Command: `node --test test/argumentCodeActions.test.js --test-name-pattern "Markdown spec arguments"`
- Result: passed, 14 tests.

## Broader Check

- Command: `git diff --check`
- Result: passed.
- Command: `npm run check`
- Result: passed, including 688 unit tests, 26 LSP tests, 36 VS Code and manifest tests, and packaging.

## Change

- Registered argument code actions for both Gauge language documents and file-backed Markdown `.md` Gauge specs.
- Registered semantic tokens for both Gauge language documents and file-backed Markdown `.md` Gauge specs.
- Added direct coverage for argument conversion in Markdown Gauge specs.
