# Step Code Actions For Gauge Files By Extension

## Scope

Register undefined-step quick fixes for `.spec` and `.cpt` files even when VS
Code has not assigned the `gauge` language id yet. Keep file-extension code
actions scoped to files that resolve to a Gauge project.

## Reference

- `references/intellij-gauge-plugin/resources/META-INF/plugin.xml`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileTypeFactory.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/annotator/StepAnnotator.java`
- `references/gauge-vscode/src/annotator/generateStub.ts`

## Target

- `src/stepCodeActions.js`
- `src/extension.js`
- `test/stepCodeActions.test.js`
- `test/extension.test.js`

## RED

Command:

```sh
node --test --test-name-pattern "concept files by extension|Gauge files by extension outside Gauge projects|activation starts Gauge workspace services|activation shows install guidance" test/stepCodeActions.test.js test/extension.test.js
```

Result: failed. 6 selected tests ran, 4 failed. Plaintext `.cpt` files did not
receive undefined-step fixes, plaintext `.spec` files outside Gauge projects
still received fixes, and activation did not register `.spec` or `.cpt`
selectors for the step code action provider.

## GREEN

Command:

```sh
node --test --test-name-pattern "concept files by extension|Gauge files by extension outside Gauge projects|activation starts Gauge workspace services|activation shows install guidance" test/stepCodeActions.test.js test/extension.test.js
```

Result: passed. 6 tests passed, 0 failed.

## Broader Check

Command:

```sh
node --test test/stepCodeActions.test.js test/extension.test.js
```

Result: passed. 40 tests passed, 0 failed.
