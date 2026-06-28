# Nested Gauge Project Discovery

Scope: PCW-C1 starts Gauge LSP clients for nested Gauge projects under a non-Gauge workspace folder.

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/GaugeModuleComponent.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/core/Gauge.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/GaugeUtil.java`

Target files:
- `src/gaugeWorkspace.js`
- `test/gaugeWorkspace.test.js`

RED:
- Command: `node --test --test-name-pattern "nested Gauge projects" test/gaugeWorkspace.test.js`
- Result: failed, 0 passed and 1 failed.
- Failing test: `GaugeWorkspace starts LSP clients for nested Gauge projects under a workspace folder`.
- Failure: no client was created for `/workspace/service-a` because startup only tried the workspace folder root.

GREEN:
- Command: `node --test --test-name-pattern "nested Gauge projects" test/gaugeWorkspace.test.js`
- Result: passed, 1 test passed.

Related checks:
- Command: `node --test test/gaugeWorkspace.test.js test/gaugeClients.test.js test/projectFactory.test.js test/extension.test.js`
- Result: passed, 46 tests passed.

Broad check:
- Command: `npm run check`
- Result: passed.
- Unit tests: 592 passed.
- LSP tests: 21 passed.
- VS Code tests: 25 passed.
- Package: passed.
