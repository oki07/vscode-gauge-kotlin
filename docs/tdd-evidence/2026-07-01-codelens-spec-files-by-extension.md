# CodeLens Spec Files By Extension

## Scope

Gauge run and debug CodeLens support must apply to `.spec` files even when VS Code opens the document as plaintext. The provider must keep concept files excluded and must keep project-root gating in place.

## Reference

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileTypeFactory.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/GaugeExecutionProducer.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/ScenarioExecutionProducer.java`
- `references/gauge-vscode/src/explorer/specExplorer.ts`
- `references/gauge-vscode/src/execution/gaugeExecutor.ts`

## RED

- Command: `node --test --test-name-pattern "spec files by extension|activation registers Gauge run code lenses" test/codeLensProvider.test.js test/extension.test.js`
- Result: failed with 2 failing tests. Plaintext `.spec` documents returned no run/debug CodeLens, and activation registered no `**/*.spec` CodeLens selector.

## GREEN

- Command: `node --test --test-name-pattern "spec files by extension|activation registers Gauge run code lenses" test/codeLensProvider.test.js test/extension.test.js`
- Result: passed with 3 selected tests.

## Implementation

- Added `.spec` extension support to `GaugeCodeLensProvider` before markdown-specific detection.
- Registered the existing `SPEC_FILE_SELECTOR` with the CodeLens provider.
- Added provider and activation regression coverage.

## Broader Check

- Command: `node --test test/codeLensProvider.test.js test/extension.test.js`
- Result: passed with 42 tests.
- Command: `npm run check`
- Result: passed. Unit tests passed with 779 tests, LSP tests passed with 28 tests, VS Code tests passed with 41 tests, and packaging completed with 468 VSIX files.
