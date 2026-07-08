# IntelliJ Table Snippet Indentation

Reference:
- `references/intellij-gauge-plugin/resources/liveTemplates/gaugeTemplates.xml`

Parity behavior:
- IntelliJ Gauge live templates for `table:1` through `table:6` insert a leading newline and four-space indented table rows.
- The VS Code Gauge snippets with matching legacy table prefixes should preserve that body shape.

RED:
- Command: `node --test --test-name-pattern "core Gauge VS Code surface" test/manifest.test.js`
- Result: failed because `Legacy Table with two columns` had no leading empty line or four-space indentation.

GREEN:
- Command: `node --test --test-name-pattern "core Gauge VS Code surface" test/manifest.test.js`
- Result: passed after legacy table snippets were updated to include the IntelliJ live-template indentation.
