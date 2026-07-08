# Activation Unresolved Project Root Filtering

Reference:
- `references/gauge-vscode/src/util.ts`
- `references/gauge-vscode/src/extension.ts`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/GaugeEnterHandlerDelegate.java`
- `vscode-gauge-kotlin/src/argumentCodeActions.js`
- `vscode-gauge-kotlin/src/codeLensProvider.js`
- `vscode-gauge-kotlin/src/foldingRangeProvider.js`
- `vscode-gauge-kotlin/src/stepDiagnostics.js`

Parity behavior:
- Extension-only Gauge file support must not start Gauge services when project root resolution returns no root.
- Active Kotlin implementation documents must not start Gauge services when project root resolution returns no root.
- Enter handling for extension-only Gauge files must not save files when project root resolution returns no root.

RED:
- Command: `node --test --test-name-pattern "project root is unresolved|Kotlin implementation documents when project root is unresolved|Gauge files by extension when project root is unresolved" test/extension.test.js test/gaugeEnterHandler.test.js`
- Result: failed 3 tests because activation called `createCli` for unresolved roots and the enter handler saved an unresolved `.spec` file.

GREEN:
- Command: `node --test --test-name-pattern "project root is unresolved|Kotlin implementation documents when project root is unresolved|Gauge files by extension when project root is unresolved" test/extension.test.js test/gaugeEnterHandler.test.js`
- Result: passed after unresolved roots were treated as non-Gauge activation and enter-handler targets.

Focused:
- Command: `node --test test/extension.test.js test/gaugeEnterHandler.test.js`
- Result: passed, 44 tests.
