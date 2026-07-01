# Enter handler Gauge files by extension

## Scope

The editor enter handler must save Gauge `.spec` and `.cpt` files after
newline edits even when the VS Code document language id is still `plaintext`.

## Reference

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/GaugeEnterHandlerDelegate.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileTypeFactory.java`

The IntelliJ reference saves documents after Enter when `GaugeUtil.isGaugeFile`
accepts the virtual file. `.spec` and `.cpt` are registered as Gauge file
types by extension.

## Target

- `src/gaugeEnterHandler.js`
- `test/gaugeEnterHandler.test.js`

## RED

Command:

```text
node --test --test-name-pattern "saves spec files by extension|saves concept files by extension" test/gaugeEnterHandler.test.js
```

Result: failed. `GaugeEnterHandler` did not resolve project roots or save
`plaintext` `.spec` and `.cpt` documents after newline edits.

## GREEN

Command:

```text
node --test --test-name-pattern "saves spec files by extension|saves concept files by extension" test/gaugeEnterHandler.test.js
```

Result: passed.

## Broader check

Command:

```text
node --test test/gaugeEnterHandler.test.js
```

Result: passed with 6 tests.
