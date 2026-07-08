# Gauge Workspace Client Disposal

Reference:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/GaugeComponent.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/core/Gauge.java`

Parity behavior:
- Closing a Gauge project disposes active Gauge services.
- The VS Code adaptation must stop active Gauge LSP clients when `GaugeWorkspace` is disposed.

RED:
- Command: `node --test --test-name-pattern "disposes active clients" test/gaugeWorkspace.test.js`
- Result: failed because `GaugeWorkspace.dispose()` disposed listeners only and left the active client unstopped.

GREEN:
- Command: `node --test --test-name-pattern "disposes active clients" test/gaugeWorkspace.test.js`
- Result: passed after `GaugeWorkspace.dispose()` stopped active clients and cleared client maps.

Focused:
- Command: `node --test test/gaugeWorkspace.test.js`
- Result: passed, 29 tests.
