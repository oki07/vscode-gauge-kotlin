# Unique Step stub names

Parity item: SRC-ED-004

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/annotator/CreateStepImplFix.java`
- `references/gauge-vscode/src/annotator/generateStub.ts`

Behavior:
- Locally generated Kotlin Step stubs should avoid reusing an existing `implementation` function name.
- When `implementation` already exists in open Kotlin implementation files, the generated stub should use the next available `implementationN` name.

RED:
- Command: `node --test --test-name-pattern "avoids duplicate Kotlin step stub names" test/stepCodeActions.test.js`
- Result: failed 1 of 1. The generated stub used `fun implementation(...)` instead of `fun implementation1(...)`.

GREEN:
- Command: `node --test --test-name-pattern "avoids duplicate Kotlin step stub names" test/stepCodeActions.test.js`
- Result: passed 1 of 1.

Related:
- Command: `node --test test/stepCodeActions.test.js test/argumentCodeActions.test.js test/extension.test.js`
- Result: passed 36 of 36.

Broad:
- Command: `npm run check`
- Result: passed. Unit 598 of 598, LSP 22 of 22, VS Code 25 of 25, package succeeded.

## Scope Correction

The workspace-wide quick-fix name selection recorded above was superseded on 2026-07-10.
`GaugeStepCodeActionProvider` now keeps the initial method name as `implementation`, and
`GenerateStubCommandProvider` chooses the next available `implementationN` name only after the
user selects the destination Kotlin or Java file. This matches `CreateStepImplFix`, which checks
the selected implementation class rather than unrelated open source files.
