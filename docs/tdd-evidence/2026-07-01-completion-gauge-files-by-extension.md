# Completion For Gauge Files By Extension

## Scope

Register Gauge dynamic argument and step completion for `.spec` and `.cpt`
files even when VS Code has not assigned the `gauge` language id yet. Keep
completion scoped to files that resolve to a Gauge project.

## Reference

- `references/intellij-gauge-plugin/resources/META-INF/plugin.xml`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileTypeFactory.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/autocomplete/DynamicArgCompletionProvider.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/autocomplete/StepCompletionContributor.java`
- `references/gauge-vscode/src/extension.ts`

## Target

- `src/dynamicArgumentCompletion.js`
- `src/extension.js`
- `test/dynamicArgumentCompletion.test.js`
- `test/extension.test.js`

## RED

Command:

```sh
node --test --test-name-pattern "completion|Step aliases in spec files by extension|concept dynamic arguments in concept files by extension" test/dynamicArgumentCompletion.test.js test/extension.test.js
```

Result: failed. 5 selected tests ran, 3 failed. Plaintext `.spec` files did not
receive step completions, plaintext `.cpt` files did not receive concept dynamic
argument completions, and activation did not register `.spec` or `.cpt`
completion selectors.

## GREEN

Command:

```sh
node --test --test-name-pattern "completion|Step aliases in spec files by extension|concept dynamic arguments in concept files by extension" test/dynamicArgumentCompletion.test.js test/extension.test.js
```

Result: passed. 5 tests passed, 0 failed.

## Broader Check

Command:

```sh
node --test test/dynamicArgumentCompletion.test.js test/extension.test.js
```

Result: passed. 74 tests passed, 0 failed.
