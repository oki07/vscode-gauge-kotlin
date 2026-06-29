# Markdown Gauge Comment Command

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/StepCommenter.java`
- `vscode-gauge-kotlin/language-configuration.json`

## RED

- Command: `node --test test/commentCommand.test.js`
- Result: failed, 0 passed and 2 failed.
- Failure: `../src/commentCommand` was missing, so Markdown Gauge specs had no dedicated Gauge line-comment command.

## GREEN

- Command: `node --test test/commentCommand.test.js`
- Result: passed, 2 tests.
- Command: `node --test test/commentCommand.test.js test/extension.test.js test/manifest.test.js`
- Result: passed, 41 tests.

## Broader Check

- Command: `npm run check`
- Result: passed, including 717 unit tests, 27 LSP tests, 39 VS Code and manifest tests, and packaging.

## Change

- Added a Gauge line-comment toggle command for Markdown Gauge specs.
- Added Ctrl+/ and Cmd+/ keybindings for Markdown `.md` Gauge specs under Gauge activation.
- Delegated non-Gauge Markdown documents back to the default VS Code line-comment command.
