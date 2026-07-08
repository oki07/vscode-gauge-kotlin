# Java New Stub File Precreation

Reference:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/annotator/GaugeCreateClassAction.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/annotator/CreateStepImplFix.java`
- `references/gauge-java/src/main/java/com/thoughtworks/gauge/connection/StubImplementationCodeProcessor.java`

Parity behavior:
- Creating a Java step implementation in a new file must let the Gauge Java runner generate a class for the chosen file path.
- The Gauge Java stub processor uses the selected file path when the file exists and is empty; missing files fall back to the runner default implementation file.

RED:
- Command: `node --test --test-name-pattern "defaults new step files to Java paths" test/generateStub.test.js`
- Result: failed because `GenerateStubCommandProvider` sent `gauge/putStubImpl` before creating `/workspace/src/test/java/NewSteps.java`.

GREEN:
- Command: `node --test --test-name-pattern "defaults new step files to Java paths" test/generateStub.test.js`
- Result: passed after new Java implementation files are created before the LSP request.

Focused:
- Command: `node --test test/generateStub.test.js`
- Result: passed, 7 tests.
