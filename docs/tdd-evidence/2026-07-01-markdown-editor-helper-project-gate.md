# Markdown editor helper project gate

Reference behavior:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/GaugeEnterHandlerDelegate.java` saves only files accepted by `GaugeUtil.isGaugeFile`.
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/GaugeUtil.java` ties Gauge editor behavior to Gauge file types.
- The VS Code extension extends editor helpers to Markdown Gauge specifications, so Markdown helpers must also respect the resolved Gauge project gate.

Target behavior:
- Markdown Gauge specifications still auto-save after newline edits.
- Markdown files whose resolved root is explicitly not a Gauge project do not auto-save through `GaugeEnterHandler`.
- Markdown files whose resolved root is explicitly not a Gauge project delegate line comments to the default VS Code comment command instead of applying Gauge `//` edits.

RED:
- `node --test test/gaugeEnterHandler.test.js --test-name-pattern "resolved root is not a Gauge project"`
- Result: failed before implementation because the Markdown document was saved even when `isGaugeProject(root)` returned false.
- `node --test test/commentCommand.test.js --test-name-pattern "resolved root is not a Gauge project"`
- Result: failed before implementation because the Markdown document received a Gauge line-comment edit instead of delegating.

GREEN:
- `node --test test/gaugeEnterHandler.test.js --test-name-pattern "resolved root is not a Gauge project"`
- `node --test test/commentCommand.test.js --test-name-pattern "resolved root is not a Gauge project"`
- `node --test test/gaugeEnterHandler.test.js`
- `node --test test/commentCommand.test.js`
- Result: passed after implementation.
