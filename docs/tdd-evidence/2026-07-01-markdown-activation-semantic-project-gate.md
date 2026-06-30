# Markdown activation and semantic token project gate

Reference behavior:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/GaugeUtil.java` limits Gauge behavior to Gauge file types.
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/highlight/ErrorHighLighter.java` and syntax/highlight registrations operate on Gauge files, not arbitrary Markdown documents.
- The VS Code extension extends Gauge behavior to Markdown Gauge specs, so Markdown activation and semantic tokenization must still respect the resolved Gauge project gate.

Target behavior:
- Markdown Gauge specifications still activate Gauge services and semantic tokenization when they belong to a Gauge project.
- Markdown documents whose resolved root is explicitly not a Gauge project do not activate Gauge services.
- Markdown documents whose resolved root is explicitly not a Gauge project do not receive Gauge semantic tokens.

RED:
- `node --test test/semanticTokensProvider.test.js --test-name-pattern "resolved root is not a Gauge project"`
- Result: failed before implementation because the Markdown document received Gauge semantic tokens when `isGaugeProject(root)` returned false.
- `node --test test/extension.test.js --test-name-pattern "resolved root is not a Gauge project"`
- Result: failed before implementation because activation attempted to create Gauge services for that Markdown document.

GREEN:
- `node --test test/semanticTokensProvider.test.js --test-name-pattern "resolved root is not a Gauge project"`
- `node --test test/extension.test.js --test-name-pattern "resolved root is not a Gauge project"`
- `node --test test/semanticTokensProvider.test.js`
- `node --test test/extension.test.js`
- Result: passed after implementation.
