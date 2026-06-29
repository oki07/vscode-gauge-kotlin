# Runtime Language Configuration

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/StepCommenter.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/autocomplete/ArgQuoteHandler.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/autocomplete/PairMatcher.java`
- `vscode-gauge-kotlin/language-configuration.json`

## RED

- Command: `node --test test/extension.test.js --test-name-pattern "activation preserves Gauge editor language configuration"`
- Result: failed, 26 passed and 1 failed.
- Failure: runtime Gauge language configuration omitted `comments`.

## GREEN

- Command: `node --test test/extension.test.js --test-name-pattern "activation preserves Gauge editor language configuration"`
- Result: passed, 27 tests.
- Command: `npm run test:vscode`
- Result: passed, 38 tests.

## Broader Check

- Command: `npm run check`
- Result: passed, including 712 unit tests, 27 LSP tests, 38 VS Code and manifest tests, and packaging.

## Change

- Preserved Gauge line comment behavior in runtime language configuration.
- Preserved Gauge angle and quote bracket pairs for brackets, auto-closing pairs, and surrounding pairs.
- Kept the existing Gauge step word pattern registration.
