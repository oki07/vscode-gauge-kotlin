# Semantic Tokens For Gauge Files By Extension

## Scope

Register semantic tokens for Gauge `.spec` and `.cpt` files even when VS Code
has not assigned the `gauge` language id yet. When these file-extension
selectors are active, keep semantic tokenization scoped to files that resolve to
a Gauge project.

## Reference

- `references/intellij-gauge-plugin/resources/META-INF/plugin.xml`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileTypeFactory.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/highlight/SpecSyntaxHighlighter.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/highlight/ConceptSyntaxHighlighter.java`

## Target

- `src/semanticTokensProvider.js`
- `src/extension.js`
- `test/semanticTokensProvider.test.js`
- `test/extension.test.js`

## RED

Command:

```sh
node --test --test-name-pattern "Gauge files by extension outside Gauge projects|activation starts Gauge workspace services for Gauge projects" test/semanticTokensProvider.test.js test/extension.test.js
```

Result: failed. The activation selector did not include `.spec` or `.cpt` file
patterns, and plaintext `.spec` documents outside Gauge projects still received
semantic tokens.

## GREEN

Command:

```sh
node --test --test-name-pattern "Gauge files by extension outside Gauge projects|activation starts Gauge workspace services for Gauge projects" test/semanticTokensProvider.test.js test/extension.test.js
```

Result: passed. 2 tests passed, 0 failed.

## Broader Check

Command:

```sh
node --test test/semanticTokensProvider.test.js test/extension.test.js
```

Result: passed. 60 tests passed, 0 failed.
