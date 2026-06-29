# Java Fenced Code Grammar

Reference source:
- `references/gauge-vscode/package.json`
- `references/gauge-vscode/syntaxes/markdown.tmLanguage`

Target behavior:
- Gauge TextMate grammar recognizes Java and BeanShell fenced code blocks.
- Java fenced code content is marked as `meta.embedded.block.java`.
- Java fenced code content includes `source.java`.

RED:
- Command: `node --test test/manifest.test.js --test-name-pattern "TextMate grammar"`
- Result: failed before implementation, with missing `markdownJavaFencedCode`.

GREEN:
- Command: `node --test test/manifest.test.js --test-name-pattern "TextMate grammar"`
- Result: passed after implementation.

Broader checks:
- Command: `node -e 'JSON.parse(require("node:fs").readFileSync("syntaxes/gauge.tmLanguage.json", "utf8"));'`
- Result: passed.
- Command: `npm run check`
- Result: passed, 672 unit tests, 25 LSP tests, 33 VS Code surface tests, and VSIX packaging.
- Command: `git diff --check`
- Result: passed.
- Command: `../.codex/hooks/check-source-language.sh`
- Result: passed.
