# Markdown Gauge Language Activation Gate

## Reference Source

- `references/gauge-vscode/package.json`
- `references/gauge-vscode/src/util.ts`
- `references/gauge-vscode/src/extension.ts`

## RED

- Command: `node --test test/extension.test.js --test-name-pattern "activation ignores Markdown Gauge language documents outside Gauge projects"`
- Result: failed.
- Failure: an active `.md` document reported as `languageId: "gauge"` started Gauge services and called `createCli` even though it was outside any Gauge project.

## GREEN

- Command: `node --test test/extension.test.js --test-name-pattern "activation ignores Markdown Gauge language documents outside Gauge projects|activation starts Gauge workspace services for Gauge projects|activation defers CLI and debug provider creation when Gauge services are not needed"`
- Result: passed, 26 tests.

## Broader Check

- Command: `npm run check`
- Result: passed, including 704 unit tests, 27 LSP tests, 37 VS Code and manifest tests, and packaging.

## Change

- Treated active `.md` documents as Gauge documents only when the project factory resolves a Gauge root.
- Preserved normal `gauge` language activation for non-Markdown Gauge documents.
- Allowed Markdown Gauge support to remain project-gated even when VS Code reports `.md` files with the `gauge` language id.
