# Format spec files by extension

## Scope

Gauge formatting must treat `.spec` files as Gauge specification files even
when the VS Code document language id has not been associated with `gauge`.

## Reference

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileTypeFactory.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileType.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/formatter/SpecFormatter.java`

The IntelliJ reference registers `.spec` as the Gauge specification file type
and the formatter runs `gauge format` on the selected file path.

## Target

- `src/formatProvider.js`
- `test/formatProvider.test.js`

## RED

Command:

```text
node --test --test-name-pattern "spec files by extension" test/formatProvider.test.js
```

Result: failed. `GaugeFormatProvider formats spec files by extension` returned
no spawned Gauge format command for `/workspace/gauge/specs/plain.spec` when
the document language id was `plaintext`.

## GREEN

Command:

```text
node --test --test-name-pattern "spec files by extension" test/formatProvider.test.js
```

Result: passed.

## Broader check

Command:

```text
node --test test/formatProvider.test.js
```

Result: passed with 9 tests.
