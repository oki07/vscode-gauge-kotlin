# Markdown Snippets

## Reference Source

- `references/intellij-gauge-plugin/resources/META-INF/plugin.xml`
- `references/intellij-gauge-plugin/resources/liveTemplates/gaugeTemplates.xml`
- `references/gauge-vscode/snippets/gauge.json`

## RED

- Command: `node --test test/manifest.test.js --test-name-pattern "extension manifest exposes the core Gauge VS Code surface for Kotlin projects"`
- Result: failed.
- Failure: the manifest contributed Gauge snippets only for the `gauge` language, so Markdown `.md` Gauge specs opened with `languageId: "markdown"` did not receive the live template equivalent.

## GREEN

- Command: `node --test test/manifest.test.js --test-name-pattern "extension manifest exposes the core Gauge VS Code surface for Kotlin projects"`
- Result: passed, 11 tests.

## Broader Check

- Command: `git diff --check`
- Result: passed.
- Command: `npm run check`
- Result: passed, including 688 unit tests, 26 LSP tests, 36 VS Code and manifest tests, and packaging.

## Change

- Reused `snippets/gauge.json` for both `gauge` and `markdown` language contributions.
