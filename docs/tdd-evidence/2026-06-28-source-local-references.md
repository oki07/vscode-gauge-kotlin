# Source Local References

Scope: LNG-006 and LNG-007 source parity gaps. Gauge references should work from Gauge step cursors without an LSP response, and local reference search should include concept headings.

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/findUsages/ReferenceSearch.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/findUsages/helper/ReferenceSearchHelper.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/StepUtil.java`
- Existing target parsing helpers in `src/stepDefinitionProvider.js` and `src/stepDiagnostics.js`

Target files:
- `src/gaugeReference.js`
- `test/gaugeReference.test.js`

RED:
- Command: `node --test test/gaugeReference.test.js`
- Result: failed, 16 passed and 2 failed.
- Failing tests:
  - `ReferenceProvider provides local references from Gauge step cursor without LSP`
  - `ReferenceProvider includes concept headings in local Step references`
- Failures:
  - Gauge documents without an LSP client produced no local step references.
  - Local reference search did not include `.cpt` concept headings.

GREEN:
- Command: `node --test test/gaugeReference.test.js`
- Result: passed, 18 tests passed.

Related checks:
- Command: `node --test test/gaugeReference.test.js test/stepDefinitionProvider.test.js test/stepDiagnostics.test.js test/extension.test.js`
- Result: passed, 253 tests passed.
- Command: `npm run check`
- Result: passed.
- Unit tests: 584 passed.
- LSP tests: 20 passed.
- VS Code manifest/extension tests: 24 passed.
- Package step: passed.
