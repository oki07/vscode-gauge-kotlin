# Folding Gauge Files By Extension

## Scope

Fold Gauge specification and concept documents when VS Code has not assigned the
`gauge` language id yet, as long as the file path ends with `.spec` or `.cpt`
and the file belongs to a Gauge project.

## Reference

- `references/intellij-gauge-plugin/resources/META-INF/plugin.xml`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileTypeFactory.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/folding/SpecFoldingBuilder.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/folding/ConceptFoldingBuilder.java`

## Target

- `src/foldingRangeProvider.js`
- `src/extension.js`
- `test/foldingRangeProvider.test.js`
- `test/extension.test.js`

## RED

Command:

```sh
node --test --test-name-pattern "folds spec files by extension|folds concept files by extension|activation starts Gauge workspace services for Gauge projects" test/foldingRangeProvider.test.js test/extension.test.js
```

Result: failed. The activation selector did not include `.spec` or `.cpt` file
patterns, and plaintext `.spec` and `.cpt` documents returned no folding ranges.

## GREEN

Command:

```sh
node --test --test-name-pattern "folds spec files by extension|folds concept files by extension|activation starts Gauge workspace services for Gauge projects" test/foldingRangeProvider.test.js test/extension.test.js
```

Result: passed. 3 tests passed, 0 failed.

## Broader Check

Command:

```sh
node --test test/foldingRangeProvider.test.js test/extension.test.js
```

Result: passed. 43 tests passed, 0 failed.
