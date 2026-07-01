# Step Code Action Activation

## Reference behavior

- Reference path: `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/annotator/CreateStepImplFix.java`
- Local provider: `src/stepCodeActions.js`
- Local activation: `src/extension.js`

Undefined Gauge steps should expose local quick fixes to create a Kotlin step
implementation or a concept. The provider existed locally, but extension
activation registered only the argument code action provider.

## RED

Command:

```text
node --test --test-name-pattern "starts Gauge workspace services" test/extension.test.js
```

Result: failed. The activation test expected a second code action provider and
failed with `TypeError: Cannot read properties of undefined (reading
'disposable')`, proving that the step code action provider was not registered.

## GREEN

Command:

```text
node --test --test-name-pattern "starts Gauge workspace services" test/extension.test.js
```

Result: passed with 3 selected tests after registering
`GaugeStepCodeActionProvider` for Gauge specs and Markdown Gauge spec files.

## Broader checks

Command:

```text
node --test --test-name-pattern "starts Gauge workspace services|install guidance|core contributed Gauge commands" test/extension.test.js
```

Result: passed with 5 selected tests.

Command:

```text
node --test test/stepCodeActions.test.js
```

Result: passed with 8 tests.

Command:

```text
node --test test/extension.test.js
```

Result: passed with 29 tests.
