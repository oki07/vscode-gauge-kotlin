# Argument Code Actions For Gauge Files By Extension

## Scope

Register argument conversion code actions for `.spec` and `.cpt` files even
when VS Code has not assigned the `gauge` language id yet. Keep file-extension
code actions scoped to files that resolve to a Gauge project.

## Reference

- `references/intellij-gauge-plugin/resources/META-INF/plugin.xml`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileTypeFactory.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/intention/ConvertArgTypeIntentionBase.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/intention/ConvertToDynamicArgIntention.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/intention/ConvertToStaticArgIntention.java`

## Target

- `src/argumentCodeActions.js`
- `src/extension.js`
- `test/argumentCodeActions.test.js`
- `test/extension.test.js`

## RED

Command:

```sh
node --test --test-name-pattern "Gauge files by extension outside Gauge projects|activation starts Gauge workspace services for Gauge projects" test/argumentCodeActions.test.js test/extension.test.js
```

Result: failed. 2 selected tests failed. Plaintext `.spec` files outside Gauge
projects still received argument conversion actions, and activation did not
register `.spec` or `.cpt` code action selectors for the argument provider.

## GREEN

Command:

```sh
node --test --test-name-pattern "Gauge files by extension outside Gauge projects|activation starts Gauge workspace services for Gauge projects" test/argumentCodeActions.test.js test/extension.test.js
```

Result: passed. 2 tests passed, 0 failed.

## Broader Check

Command:

```sh
node --test test/argumentCodeActions.test.js test/extension.test.js
```

Result: passed. 46 tests passed, 0 failed.
