# Spec Heading Semantic Arguments

Reference source:
- `references/gauge-vscode/src/semanticTokensProvider.ts`

Target behavior:
- `.spec` hash headings tokenize dynamic arguments inside `<...>`.
- `.spec` hash headings tokenize static arguments inside quotes.
- Existing heading token types remain `specification` and `scenario`.

RED:
- Command: `node --test test/semanticTokensProvider.test.js --test-name-pattern "distinguishes specification scenario and concept headings"`
- Result: failed before implementation, with only the whole heading token and no argument token.

GREEN:
- Command: `node --test test/semanticTokensProvider.test.js`
- Result: passed, 27 tests.

Broader checks:
- Command: `node --check src/semanticTokensProvider.js`
- Result: passed.
- Command: `npm run check`
- Result: passed, 672 unit tests, 25 LSP tests, 33 VS Code surface tests, and VSIX packaging.
- Command: `git diff --check`
- Result: passed.
- Command: `../.codex/hooks/check-source-language.sh`
- Result: passed.
