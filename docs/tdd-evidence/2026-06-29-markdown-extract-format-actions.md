# Markdown Extract And Format Actions

## Reference Source

- `references/intellij-gauge-plugin/resources/META-INF/plugin.xml`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/extract/ExtractConceptAction.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/formatter/SpecFormatter.java`

## RED

- Command: `node --test test/extractConcept.test.js --test-name-pattern "Markdown Gauge specs"`
- Result: failed, 25 passed and 1 failed.
- Failure reason: `ExtractConceptCommandProvider` rejected Markdown Gauge specs as non-Gauge documents.

- Command: `node --test test/extension.test.js --test-name-pattern "active Markdown Gauge specs"`
- Result: failed, 23 passed and 1 failed.
- Failure reason: `gauge.format` did not run for an active Markdown Gauge spec.

- Command: `node --test test/manifest.test.js --test-name-pattern "core Gauge VS Code surface"`
- Result: failed, 10 passed and 1 failed.
- Failure reason: editor actions and keybindings only exposed Gauge format/extract/preview for `editorLangId == gauge`.

## GREEN

- Command: `node --test test/extractConcept.test.js --test-name-pattern "Markdown Gauge specs"`
- Result: passed, 26 tests.

- Command: `node --test test/extension.test.js --test-name-pattern "active Markdown Gauge specs"`
- Result: passed, 24 tests.

- Command: `node --test test/manifest.test.js --test-name-pattern "core Gauge VS Code surface"`
- Result: passed, 11 tests.

## Broader Checks

- Command: `npm run check`
- Result: passed, 675 unit tests, 25 LSP tests, 35 VS Code surface tests, and VSIX packaging.

## Change

- Markdown `.md` Gauge specs in Gauge projects can use the `gauge.format` command.
- Markdown `.md` Gauge specs can use Extract to Concept when a Gauge project client is available.
- Format, Extract to Concept, and Preview editor actions are visible for Markdown `.md` Gauge specs.
