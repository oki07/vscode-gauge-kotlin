# Java Config After Runner Install

Reference source:
- `references/gauge-vscode/src/gaugeWorkspace.ts`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/GaugeModuleComponent.java`

Target behavior:
- When a Java Gauge project is opened without the Java runner installed, accepting runner installation should still generate the Java project config before the language server starts.
- The client remains visible in the project client map while runner installation is pending.

RED:
- Command: `node --test test/gaugeWorkspace.test.js`
- Result: failed before implementation.
- Failing test:
  - `GaugeWorkspace generates Java config after installing a missing Java runner`

GREEN:
- Command: `node --test test/gaugeWorkspace.test.js`
- Result: passed, 21 tests.

Broader checks:
- Command: `npm run check`
- Result: passed, 649 unit tests, 25 LSP tests, 30 VS Code surface tests, and VSIX packaging.
- Command: `git diff --check`
- Result: passed.
- Command: `../.codex/hooks/check-source-language.sh`
- Result: passed.
