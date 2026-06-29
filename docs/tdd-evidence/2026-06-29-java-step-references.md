# Java Step References

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/findUsages/CustomFindUsagesHandlerFactory.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/findUsages/helper/ReferenceSearchHelper.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/reference/StepReference.java`

Target behavior:
- Java `@Step` implementation documents can provide local Gauge step references.
- The reference provider is registered for Java language documents and `.java` files.
- Kotlin reference behavior still resolves constant-backed aliases through Kotlin-only constant analysis.

RED:
- Command: `node --test test/gaugeReference.test.js --test-name-pattern "Java Step aliases"`
- Result: failed before implementation, with no local references for the Java `@Step` method.
- Command: `node --test test/extension.test.js --test-name-pattern "activation registers Gauge reference providers"`
- Result: failed before implementation, with no Java reference provider selector.

GREEN:
- Command: `node --test test/gaugeReference.test.js test/extension.test.js --test-name-pattern "Java Step aliases|activation registers Gauge reference providers"`
- Result: passed, 42 tests.

Broader checks:
- Command: `node --check src/gaugeReference.js`
- Result: passed.
- Command: `npm run check`
- Result: passed, 671 unit tests, 25 LSP tests, 33 VS Code surface tests, and VSIX packaging.
- Command: `git diff --check`
- Result: passed.
- Command: `../.codex/hooks/check-source-language.sh`
- Result: passed.
