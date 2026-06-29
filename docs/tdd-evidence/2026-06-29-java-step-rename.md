# Java Step Rename

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/rename/CustomRenameHandler.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/rename/GaugeRefactorHandler.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/StepUtil.java`

Target behavior:
- Rename can start from a Java `@Step` annotation literal.
- Java step annotation literals are updated together with matching Gauge spec steps.
- Rename provider registration includes Java language documents and `.java` files.

RED:
- Command: `node --test test/renameProvider.test.js --test-name-pattern "Java Step annotations|plaintext Kotlin file rename selector"`
- Result: failed before implementation, with no rename edit for Java `@Step` and no Java rename selector.

GREEN:
- Command: `node --test test/renameProvider.test.js --test-name-pattern "Java Step annotations|plaintext Kotlin file rename selector"`
- Result: passed after implementation.

Broader checks:
- Command: `node --check src/renameProvider.js`
- Result: passed.
- Command: `npm run check`
- Result: passed, 672 unit tests, 25 LSP tests, 33 VS Code surface tests, and VSIX packaging.
- Command: `git diff --check`
- Result: passed.
- Command: `../.codex/hooks/check-source-language.sh`
- Result: passed.
