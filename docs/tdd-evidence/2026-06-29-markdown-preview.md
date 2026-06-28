# Markdown Gauge Preview

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileTypeFactory.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/markdownPreview/GaugeWebBrowserPreview.java`

Target behavior:
- A `.md` Gauge specification opened with VS Code's Markdown language can use Gauge preview.
- Plaintext `.md` documents remain outside the preview command's active Gauge document check.

RED:
- Command: `node --test test/preview.test.js --test-name-pattern "Markdown Gauge spec|requires an active Gauge document"`
- Result: failed, 5 passed and 1 failed.
- Failing test:
  - `previewGaugeDocument creates Spectacle docs for a Markdown Gauge spec`

GREEN:
- Command: `node --test test/preview.test.js --test-name-pattern "Markdown Gauge spec|requires an active Gauge document"`
- Result: passed, 6 tests.

Broader checks:
- Command: `npm run check`
- Result: passed, 663 unit tests, 25 LSP tests, 33 VS Code surface tests, and VSIX packaging.
- Command: `git diff --check`
- Result: passed.
- Command: `../.codex/hooks/check-source-language.sh`
- Result: passed.
