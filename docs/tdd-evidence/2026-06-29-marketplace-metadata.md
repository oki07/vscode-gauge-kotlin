# Marketplace Metadata

Reference source:
- `references/gauge-vscode/package.json`
- Product repository remote: `git@github.com:oki07/vscode-gauge-kotlin.git`

Target behavior:
- The VS Code extension manifest includes Marketplace publishing metadata rather than relying on `vsce --allow-missing-repository`.
- `author`, `publisher`, and `repository` are present and match this product repository identity.
- VSIX packaging succeeds without suppressing missing repository metadata.

RED:
- Command: `node --test test/manifest.test.js`
- Result: failed before implementation.
- Failing tests:
  - `extension manifest exposes the core Gauge VS Code surface for Kotlin projects`
  - `extension package script requires repository metadata`

GREEN:
- Command: `node --test test/manifest.test.js`
- Result: passed, 11 tests.

Broader checks:
- Command: `npm run check`
- Result: passed, 655 unit tests, 25 LSP tests, 32 VS Code surface tests, and VSIX packaging.
- Command: `git diff --check`
- Result: passed.
- Command: `../.codex/hooks/check-source-language.sh`
- Result: passed.
