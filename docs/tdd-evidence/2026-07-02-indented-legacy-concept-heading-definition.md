# Indented Legacy Concept Heading Definition

Scope: Concept heading discovery for indented legacy underline headings.

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_ConceptLexer.flex`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/psi/ConceptPsiImplUtil.java`

Target files:
- `src/stepDiagnostics.js`
- `test/stepDefinitionProvider.test.js`

RED:
- Command: `node --test test/stepDefinitionProvider.test.js --test-name-pattern "indented legacy concept headings"`
- Result: failed, 29 passed and 1 failed.
- Failing test: `GaugeStepDefinitionProvider resolves indented legacy concept headings`
- Failure summary: the provider returned zero definitions because `conceptLegacyHeading()` rejected legacy concept headings whose text line began with whitespace.

GREEN:
- Command: `node --test test/stepDefinitionProvider.test.js --test-name-pattern "indented legacy concept headings"`
- Result: passed, 30 tests passed.

Related checks:
- Command: `node --test test/stepDefinitionProvider.test.js test/gaugeReference.test.js test/renameProvider.test.js test/dynamicArgumentCompletion.test.js`
- Result: passed, 126 tests passed.

Broad check:
- Command: `npm run check`
- Result: passed.
- Unit tests: 796 passed.
- LSP tests: 32 passed.
- VS Code tests: 43 passed.
- Package: passed.
