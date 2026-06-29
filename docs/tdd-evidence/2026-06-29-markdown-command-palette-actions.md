# Markdown Command Palette Actions

## Reference Source

- `references/intellij-gauge-plugin/resources/META-INF/plugin.xml`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/extract/ExtractConceptAction.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/formatter/SpecFormatter.java`

## RED

- Command: `node --test test/manifest.test.js --test-name-pattern "core Gauge VS Code surface"`
- Result: failed, 10 passed and 1 failed.
- Failure reason: `gauge.extract.concept` and `gauge.format` command palette entries were still restricted to `editorLangId == gauge`.

## GREEN

- Command: `node --test test/manifest.test.js --test-name-pattern "core Gauge VS Code surface"`
- Result: passed, 11 tests.

## Broader Checks

- Command: `npm run check`
- Result: passed, 677 unit tests, 25 LSP tests, 36 VS Code surface tests, and VSIX packaging.

## Change

- `gauge.extract.concept` and `gauge.format` are now visible from the command palette for Markdown `.md` Gauge specifications as well as Gauge-language documents.
