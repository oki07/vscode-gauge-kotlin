# Reference Empty LSP Fallback

Reference:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/findUsages/ReferenceSearch.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/findUsages/StepCollector.java`

Parity behavior:
- Reference lookup must still search local Gauge specs, concepts, and Markdown Gauge specs when the Gauge language server returns an empty reference list.
- Non-empty language server reference lists must continue to be preferred.
- If both the language server and local scan find no references, an empty language server list remains empty.

RED:
- Command: `node --test --test-name-pattern "falls back to local references when LSP returns an empty list" test/gaugeReference.test.js`
- Result: failed because `editor.action.showReferences` received an empty reference list instead of the local Gauge reference.

GREEN:
- Command: `node --test --test-name-pattern "falls back to local references when LSP returns an empty list" test/gaugeReference.test.js`
- Result: passed after empty LSP arrays attempted local reference fallback.

Focused:
- Command: `node --test test/gaugeReference.test.js`
- Result: passed, 29 tests.
