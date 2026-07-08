# CLI Configured Gauge Home Probe

Reference:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/core/GaugeVersion.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/GaugeUtil.java`

Parity behavior:
- A configured Gauge executable must be validated with the configured `GAUGE_HOME` environment.
- The later machine-readable version probe must continue to use the same configured `GAUGE_HOME` environment.

RED:
- Command: `node --test --test-name-pattern "configured executable with configured GAUGE_HOME" test/cli.test.js`
- Result: failed because `getConfiguredCommand()` received no spawn options, so configured executable validation did not receive `GAUGE_HOME`.

GREEN:
- Command: `node --test --test-name-pattern "configured executable with configured GAUGE_HOME" test/cli.test.js`
- Result: passed after configured executable validation received the same `GAUGE_HOME` environment used by the version probe.

Focused:
- Command: `node --test test/cli.test.js`
- Result: passed, 14 tests.
