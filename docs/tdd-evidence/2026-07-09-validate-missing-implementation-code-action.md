# Validate missing implementation code action

## Reference source

- `references/gauge/api/lang/diagnostics.go`
- `references/gauge/validation/validation_test.go`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/annotator/StepAnnotator.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/annotator/CreateStepImplFix.java`

Gauge validation diagnostics identify missing step implementations with
`Step implementation not found`, and IntelliJ exposes a quick fix that creates
a step implementation. The VS Code code action provider must offer the same
step implementation quick fix when the diagnostic comes from `gauge validate`.

## RED

Command:

```sh
node --test test/stepCodeActions.test.js -t "GaugeStepCodeActionProvider creates fixes for gauge validate missing implementation diagnostics"
```

Result: failed. The provider returned 0 actions for a `gauge.validate`
diagnostic whose message contained `Step implementation not found`.

## GREEN

Command:

```sh
node --test test/stepCodeActions.test.js -t "GaugeStepCodeActionProvider creates fixes for gauge validate missing implementation diagnostics"
```

Result: passed.

## Regression

Command:

```sh
node --test test/stepCodeActions.test.js
```

Result: passed, 15 tests.

Command:

```sh
npm run check
```

Result: passed.
