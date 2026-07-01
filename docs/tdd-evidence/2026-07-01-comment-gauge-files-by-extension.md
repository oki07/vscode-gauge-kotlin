# Comment Gauge files by extension

## Scope

The line comment command must use Gauge `//` comments for `.spec` and `.cpt`
files even when the VS Code document language id is still `plaintext`.

## Reference

- `references/intellij-gauge-plugin/resources/META-INF/plugin.xml`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/StepCommenter.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileTypeFactory.java`

The IntelliJ reference registers `StepCommenter` for Specification and Concept
languages, and `.spec` and `.cpt` are bound to those Gauge file types.

## Target

- `src/commentCommand.js`
- `test/commentCommand.test.js`

## RED

Command:

```text
node --test --test-name-pattern "comments spec files by extension|comments concept files by extension" test/commentCommand.test.js
```

Result: failed. `toggleGaugeLineComment` delegated to the default VS Code
comment command for `plaintext` `.spec` and `.cpt` documents, so no Gauge
line-comment edit was applied.

## GREEN

Command:

```text
node --test --test-name-pattern "comments spec files by extension|comments concept files by extension" test/commentCommand.test.js
```

Result: passed.

## Broader check

Command:

```text
node --test test/commentCommand.test.js
```

Result: passed with 5 tests.
