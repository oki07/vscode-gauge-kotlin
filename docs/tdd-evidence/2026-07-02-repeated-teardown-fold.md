# Repeated Teardown Fold

Scope: Spec folding parity for repeated teardown separators.

Reference source:
- `references/intellij-gauge-plugin/src/specification.bnf`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/folding/SpecFoldingBuilder.java`

Target files:
- `src/foldingRangeProvider.js`
- `test/foldingRangeProvider.test.js`

RED:
- Command: `node --test test/foldingRangeProvider.test.js --test-name-pattern "repeated teardown separators"`
- Result: failed, 13 passed and 1 failed.
- Failing test: `GaugeFoldingRangeProvider keeps repeated teardown separators in one fold`
- Failure summary: each `___` marker created a separate fold, so a teardown with multiple separators was split into two ranges instead of one teardown range.

GREEN:
- Command: `node --test test/foldingRangeProvider.test.js --test-name-pattern "repeated teardown separators"`
- Result: passed, 14 tests passed.

Related checks:
- Command: `node --test test/foldingRangeProvider.test.js test/codeLensProvider.test.js test/testController.test.js`
- Result: passed, 57 tests passed.

Broad check:
- Command: `npm run check`
- Result: passed.
- Unit tests: 797 passed.
- LSP tests: 32 passed.
- VS Code tests: 43 passed.
- Package: passed.
