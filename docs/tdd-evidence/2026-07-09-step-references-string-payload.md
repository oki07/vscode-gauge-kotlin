# Step references LSP string payload parity

Reference:
- `references/gauge-vscode/src/gaugeReference.ts` calls
  `gauge/stepReferences` with the selected step value as a string payload.

Behavior:
- Local multi-alias aggregation can still iterate aliases, but each individual
  Gauge LSP `gauge/stepReferences` request must send the step text string
  directly instead of wrapping a single value in an array.

RED:
- Command: `node --test test/gaugeReference.test.js`
- Result: failed, 12 tests.
- Failing coverage:
  - `test/gaugeReference.test.js` observed array payloads such as
    `["Say hello"]`, `["Say hello to <name>"]`, and `["Compare <table>"]`
    where the reference extension sends plain strings.

GREEN:
- Command: `node --test test/gaugeReference.test.js`
- Result: passed, 30 tests.

Broader check:
- Command: `npm run check`
- Result: passed.
- Coverage: unit 905, LSP 33, VS Code 51, package.
