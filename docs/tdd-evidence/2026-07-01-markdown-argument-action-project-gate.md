# Markdown argument action project gate

Reference behavior:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/intention/ConvertArgTypeIntentionBase.java` runs on Gauge PSI arguments, not arbitrary Markdown text.
- `references/gauge-vscode/src/gaugeWorkspace.ts` registers the Gauge language client for Gauge project documents.

Target behavior:
- Gauge argument conversion quick fixes remain available for Markdown Gauge specifications.
- Markdown files outside Gauge projects do not receive Gauge argument conversion quick fixes.
- Activation passes the shared project factory into `GaugeArgumentCodeActionProvider` so the runtime provider can apply the same project gate.

RED:
- `node --test test/argumentCodeActions.test.js --test-name-pattern "outside Gauge projects"`
- Result: failed before implementation because `/workspace/README.md` received a `Convert to Dynamic Parameter` action.
- `node --test test/extension.test.js --test-name-pattern "argument code action"`
- Result: failed before implementation because the argument code action provider was constructed without the project factory.

GREEN:
- `node --test test/argumentCodeActions.test.js --test-name-pattern "outside Gauge projects"`
- `node --test test/extension.test.js --test-name-pattern "argument code action"`
- `node --test test/argumentCodeActions.test.js`
- `node --test test/extension.test.js`
- Result: passed after implementation.
