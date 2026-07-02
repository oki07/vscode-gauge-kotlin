# Java Step Stub Generation TDD Evidence

## Scope

- Parity item: undefined step implementation generation for Java Gauge projects.
- Reference behavior:
  - IntelliJ Gauge generates Java `@Step` methods when creating a step implementation in Java implementation classes.
  - Gauge VS Code sends runner-generated stub code through `gauge.generate.step` without forcing the code to Kotlin.
- Reference paths:
  - `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/annotator/CreateStepImplFix.java`
  - `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/annotator/FileManager.java`
  - `references/gauge-vscode/src/annotator/generateStub.ts`
- Target behavior:
  - Undefined step quick fixes create Java stubs for Gauge projects whose manifest language resolves to `java`.
  - New step implementation files default to `src/test/java/Steps.java` for Java projects.
  - Existing Kotlin project behavior remains unchanged.

## RED

- Command: `node --test test/stepCodeActions.test.js`
- Result: failed with 1 failing test.
- Failure summary: `GaugeStepCodeActionProvider creates a Java step implementation quick fix for Java projects` received a Kotlin `fun implementation(arg0: Any)` stub instead of a Java `public void implementation(Object arg0)` stub.
- Command: `node --test test/generateStub.test.js`
- Result: failed with 1 failing test.
- Failure summary: `GenerateStubCommandProvider defaults new step files to Java paths for Java projects` received the Kotlin prompt and `src/test/kotlin/Steps.kt` default.

## Implementation

- Production files:
  - `src/stepCodeActions.js`
  - `src/annotator/generateStub.js`
- Summary:
  - Added project language detection to undefined step code actions.
  - Added Java step stub generation for Java Gauge projects.
  - Added Java new-file defaults for step stub generation while preserving Kotlin defaults.
  - Kept selected-file stub insertion and Kotlin duplicate-name handling unchanged.

## GREEN

- Command: `node --test test/stepCodeActions.test.js`
- Result: passed with 11 tests.
- Command: `node --test test/generateStub.test.js`
- Result: passed with 6 tests.

## Broader Check

- Command: `npm run check`
- Result: passed. Unit tests passed 805, LSP tests passed 32, VS Code extension tests passed 45, and packaging completed.
