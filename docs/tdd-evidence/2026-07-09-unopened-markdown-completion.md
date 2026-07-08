# Unopened Markdown Completion

Reference:
- `references/gauge-vscode/src/explorer/specExplorer.ts`
- `vscode-gauge-kotlin/src/gaugeReference.js`
- `vscode-gauge-kotlin/src/stepDiagnostics.js`

Parity behavior:
- Markdown Gauge specs are Gauge spec sources.
- Completion corpus scans must include unopened Markdown Gauge specs, so used-step completion and tag completion can use steps and tags from `.md` files.

RED:
- Command: `node --test --test-name-pattern "unopened Markdown" test/dynamicArgumentCompletion.test.js`
- Result: failed because unopened `/workspace/gauge/specs/shared.md` was never scanned, leaving used-step and tag completions empty.

GREEN:
- Command: `node --test --test-name-pattern "unopened Markdown" test/dynamicArgumentCompletion.test.js`
- Result: passed after workspace document scanning included `**/*.md`.

Focused:
- Command: `node --test test/dynamicArgumentCompletion.test.js`
- Result: passed, 58 tests.
