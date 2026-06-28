# Format Provider Environment Parity

Scope: LNG-003 source parity gap. Gauge formatting from the VS Code document formatting provider must run with the same project environment as other Gauge process surfaces.

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/formatter/SpecFormatter.java`
- Existing target parity pattern in `src/execution/executor.js` and `src/validateDiagnostics.js`

Target files:
- `src/formatProvider.js`
- `test/formatProvider.test.js`

RED:
- Command: `node --test test/formatProvider.test.js`
- Result: failed, 2 passed and 1 failed.
- Failing test: `GaugeFormatProvider passes configured Gauge home and project environment`.
- Failure: provider still required `getGaugeRootFromFilePath` and did not resolve the project object or pass `env`.

GREEN:
- Command: `node --test test/formatProvider.test.js`
- Result: passed, 3 tests passed.

Related checks:
- Command: `node --test test/formatProvider.test.js test/extension.test.js`
- Result: passed, 22 tests passed.
- Command: `npm run check`
- Result: passed.
- Unit tests: 580 passed.
- LSP tests: 20 passed.
- VS Code manifest/extension tests: 24 passed.
- Package step: passed.
