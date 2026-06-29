# Docstring Step Parameters

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/psi/SpecPsiImplUtil.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/StepUtil.java`
- Existing VS Code docstring navigation parity in `src/stepDefinitionProvider.js`

## RED

- Command: `node --test test/stepCodeActions.test.js test/stepDiagnostics.test.js --test-name-pattern "docstring"`
- Result: failed, 210 passed and 2 failed.
- Failure: a docstring step quick fix generated a Kotlin stub without the docstring argument, and the diagnostics provider reported `@Step("Execute the following content") fun execute(content: String) {}` as `expected [0]`.

## GREEN

- Command: `node --test test/stepCodeActions.test.js test/stepDiagnostics.test.js --test-name-pattern "docstring"`
- Result: passed, 212 tests.
- Command: `node --test test/stepCodeActions.test.js test/stepDiagnostics.test.js test/stepDefinitionProvider.test.js`
- Result: passed, 239 tests.

## Broader Check

- Command: `npm run check`
- Result: passed, including 721 unit tests, 27 LSP tests, 39 VS Code and manifest tests, and packaging.

## Change

- Added docstring-aware step stub generation so undefined docstring steps produce a Kotlin implementation argument while keeping the annotation text unchanged.
- Taught step diagnostics to accept one implicit docstring parameter for step templates used with docstrings in Gauge specs.
- Included unopened `.spec` documents in diagnostics workspace scans so implementation files can use docstring context beyond currently open editors.
