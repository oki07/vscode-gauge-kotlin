# Format spec entry points by extension

## Scope

VS Code formatting entry points must reach Gauge `.spec` files even when the
document language id is still `plaintext`.

## Reference

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileTypeFactory.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileType.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/formatter/SpecFormatter.java`

The IntelliJ reference binds `.spec` to the Gauge specification file type and
formats the selected file path with `gauge format`.

## Target

- `src/extension.js`
- `test/extension.test.js`

## RED

Command:

```text
node --test --test-name-pattern "active spec files by extension|activation registers Gauge document formatting" test/extension.test.js
```

Result: failed. `gauge.format` did not save or spawn formatting for a
`plaintext` `/workspace/gauge/specs/example.spec` document, and the registered
document formatting selector did not include `**/*.spec`.

## GREEN

Command:

```text
node --test --test-name-pattern "active spec files by extension|activation registers Gauge document formatting" test/extension.test.js
```

Result: passed.

## Broader check

Command:

```text
node --test test/extension.test.js test/formatProvider.test.js
```

Result: passed with 39 tests.
