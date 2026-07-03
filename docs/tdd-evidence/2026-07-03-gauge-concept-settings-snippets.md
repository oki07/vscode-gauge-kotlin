# Gauge Concept Settings And Snippets TDD Evidence

## Scope

- Parity item: `gauge-concept` language split follow-up for snippets and recommended file associations.
- Reference behavior:
  - gauge-vscode contributes Gauge snippets to the language used by both `.spec` and `.cpt` files.
  - gauge-vscode recommended settings align file associations with the extension language ids.
- Reference paths:
  - `references/gauge-vscode/package.json`
  - `references/gauge-vscode/src/config/configProvider.ts`
- Target behavior:
  - `.cpt` files receive the shared Gauge snippets through `gauge-concept`.
  - Recommended workspace `files.associations` maps `*.cpt` to `gauge-concept`, preserving the split concept language id.

## RED

- Command: `node --test --test-name-pattern "extension manifest exposes the core Gauge VS Code surface for Kotlin projects|ConfigProvider applies Gauge file associations and recommended settings" test/manifest.test.js test/configProvider.test.js`
- Result: failed with 2 failing tests.
- Failure summary: `contributes.snippets` did not include `gauge-concept`, and ConfigProvider wrote `*.cpt` as `gauge`.

## Implementation

- Product files:
  - `package.json`
  - `src/config/configProvider.js`
- Summary:
  - Added the shared Gauge snippet file to the `gauge-concept` language contribution.
  - Changed recommended `*.cpt` file association from `gauge` to `gauge-concept`.

## GREEN

- Command: `node --test --test-name-pattern "extension manifest exposes the core Gauge VS Code surface for Kotlin projects|ConfigProvider applies Gauge file associations and recommended settings" test/manifest.test.js test/configProvider.test.js`
- Result: passed with 2 selected tests.

## Broader Check

- Command: `node --test test/manifest.test.js test/configProvider.test.js`
- Result: passed with 18 tests.
- Command: `npm run check`
- Result: passed. Unit tests passed 846, LSP tests passed 32, VS Code extension tests passed 47, and packaging completed.
