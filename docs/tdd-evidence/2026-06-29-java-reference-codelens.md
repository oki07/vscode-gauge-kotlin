# Java Reference CodeLens

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/findUsages/CustomFindUsagesHandlerFactory.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/findUsages/helper/ReferenceSearchHelper.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/StepUtil.java`

Target behavior:
- Java `@Step` methods expose a `Find Step References` CodeLens.
- The CodeLens passes the Java implementation URI, method-name position, and step alias to the Gauge reference command.
- The extension registers CodeLens support for Java language documents and `.java` files.

RED:
- Command: `node --test test/codeLensProvider.test.js --test-name-pattern "Java Step methods"`
- Result: failed before implementation, with no CodeLens for the Java `@Step` method.
- Command: `node --test test/extension.test.js --test-name-pattern "activation registers Gauge run code lenses"`
- Result: failed before implementation, with no Java CodeLens selector.

GREEN:
- Command: `node --test test/codeLensProvider.test.js test/extension.test.js --test-name-pattern "Java Step methods|activation registers Gauge run code lenses"`
- Result: passed, 32 tests.

Broader checks:
- Command: `node --check src/codeLensProvider.js && node --check src/extension.js`
- Result: passed.
- Command: `npm run check`
- Result: passed, 670 unit tests, 25 LSP tests, 33 VS Code surface tests, and VSIX packaging.
- Command: `git diff --check`
- Result: passed.
- Command: `../.codex/hooks/check-source-language.sh`
- Result: passed.
