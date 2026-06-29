# Kotlin Fenced Code Grammar

## Reference Source

- `references/gauge-vscode/syntaxes/markdown.tmLanguage`
- `syntaxes/gauge.tmLanguage.json`

## RED

- Command: `node --test test/manifest.test.js --test-name-pattern "TextMate grammar preserves common Markdown constructs|contributes a Gauge TextMate grammar"`
- Result: failed, 9 passed and 2 failed.
- Failing tests:
  - `extension manifest contributes a Gauge TextMate grammar`
  - `Gauge TextMate grammar preserves common Markdown constructs`
- Failure reason: the Gauge grammar did not define or include a Kotlin fenced code rule before the generic Markdown fenced code rule.

## GREEN

- Command: `node --test test/manifest.test.js --test-name-pattern "TextMate grammar preserves common Markdown constructs|contributes a Gauge TextMate grammar"`
- Result: passed, 11 tests.

## Broader Checks

- Command: `npm run check`
- Result: passed, 673 unit tests, 25 LSP tests, 34 VS Code surface tests, and VSIX packaging.

## Change

- Kotlin, `kt`, and `kts` Markdown fenced code blocks in Gauge files now embed `source.kotlin`.
- The Kotlin fenced code rule is evaluated before Java and generic fenced code rules.
