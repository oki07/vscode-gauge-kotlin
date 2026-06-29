# Markdown Grammar Parity

## Reference Source

- `references/gauge-vscode/syntaxes/markdown.tmLanguage`
- `vscode-gauge-kotlin/syntaxes/gauge.tmLanguage.json`

## RED

- Command: `node --test test/manifest.test.js --test-name-pattern "common Markdown constructs|TextMate grammar"`
- Result: failed, 9 passed and 2 failed.
- Failure: the Gauge TextMate grammar did not expose front matter or reference-style Markdown link/image rules, and common embedded fenced code languages were absent.

## GREEN

- Command: `node --test test/manifest.test.js --test-name-pattern "common Markdown constructs|TextMate grammar"`
- Result: passed, 11 tests.
- Command: `node --test test/manifest.test.js`
- Result: passed, 11 tests.

## Broader Check

- Command: `npm run check`
- Result: passed, including 717 unit tests, 27 LSP tests, 39 VS Code and manifest tests, and packaging.

## Change

- Added Markdown YAML front matter highlighting to Gauge grammar.
- Added embedded fenced code scopes for JavaScript, JSON, Python, shell, and YAML.
- Added Markdown reference-style link and image rules.
- Routed Markdown HTML block content through `text.html.basic`.
