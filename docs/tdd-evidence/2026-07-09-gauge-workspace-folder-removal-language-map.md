# Gauge Workspace Folder Removal Language Map Cleanup

Reference:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/GaugeComponent.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/core/Gauge.java`
- `references/gauge-vscode/src/gaugeWorkspace.ts`

Parity behavior:
- Removing a Gauge project stops its active Gauge service.
- The VS Code adaptation must also remove all per-project client metadata for the removed project.

RED:
- Command: `node --test --test-name-pattern "starts and stops clients" test/gaugeWorkspace.test.js`
- Result: failed because `/workspace/one` remained in `clientLanguageMap` after workspace folder removal.

GREEN:
- Command: `node --test --test-name-pattern "starts and stops clients" test/gaugeWorkspace.test.js`
- Result: passed after `GaugeWorkspace.stopServerFor()` deleted the removed project root from `clientLanguageMap`.

Focused:
- Command: `node --test test/gaugeWorkspace.test.js`
- Result: passed, 29 tests.
