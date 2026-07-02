# Reference Provider Gauge File Extension Fallback

Scope: Reference provider parity for Gauge files opened without the `gauge` language id.

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileTypeFactory.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/findUsages/StepCollector.java`

Target files:
- `src/gaugeReference.js`
- `test/gaugeReference.test.js`
- `test/extension.test.js`

RED:
- Command: `node --test test/gaugeReference.test.js --test-name-pattern "plaintext \\.spec|plaintext \\.cpt|explicit spec and concept reference selectors"`
- Result: failed, 25 passed and 3 failed.
- Failing tests:
  - `ReferenceProvider accepts plaintext .spec documents for local references`
  - `ReferenceProvider accepts plaintext .cpt concept headings for local references`
  - `ReferenceProvider registers explicit spec and concept reference selectors`
- Failure summary: plaintext `.spec` and `.cpt` documents were not accepted by the reference provider document gate, and the provider selector did not include explicit `.spec` or `.cpt` file patterns.

GREEN:
- Command: `node --test test/gaugeReference.test.js --test-name-pattern "plaintext \\.spec|plaintext \\.cpt|explicit spec and concept reference selectors"`
- Result: passed, 28 tests passed.

Related checks:
- Command: `node --test test/gaugeReference.test.js test/extension.test.js`
- Result: passed, 60 tests passed.

Broad check:
- Command: `npm run check`
- Result: passed.
- Unit tests: 795 passed.
- LSP tests: 32 passed.
- VS Code tests: 43 passed.
- Package: passed.
