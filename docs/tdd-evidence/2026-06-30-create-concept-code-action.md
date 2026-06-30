# Create concept code action

Reference behavior:
- `references/gauge/api/lang/codeAction.go` returns both `gauge.generate.step`
  and `gauge.generate.concept` commands for undefined Gauge steps.
- `references/gauge-vscode/src/annotator/generateStub.ts` registers
  `gauge.generate.concept` and forwards the selected concept target to Gauge
  LSP.

Target behavior:
- Local Kotlin undefined-step quick fixes now expose the existing
  `gauge.generate.concept` command in addition to the Kotlin step stub command.
- Dynamic and static Gauge step parameters are normalized to `<argN>` in the
  generated concept heading.

RED:
- `node --test test/stepCodeActions.test.js --test-name-pattern "concept quick fix"`
- Result: failed before implementation because only one quick fix was returned.

GREEN:
- `node --test test/stepCodeActions.test.js --test-name-pattern "concept quick fix"`
- `node --test test/stepCodeActions.test.js`
- `node --test test/argumentCodeActions.test.js --test-name-pattern "create step implementation fixes"`
- `node --test test/stepCodeActions.test.js test/argumentCodeActions.test.js test/generateStub.test.js test/extension.test.js`
- Result: passed after implementation.
