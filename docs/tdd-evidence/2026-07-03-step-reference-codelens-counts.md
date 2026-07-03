# Step Reference CodeLens Counts

## Reference Sources

- `references/gauge-lsp-tests/specifications/codelens/findUsages/java_impl.json`
- `references/gauge-lsp-tests/specifications/codelens/findAliasUsages/java_impl.json`
- `references/gauge-lsp-tests/data/find-usages/src/test/java/StepImplementation.java`
- `references/gauge-lsp-tests/data/find-usages/src/test/java/Alias.java`

## Gap

Gauge LSP reports step implementation CodeLens entries as `N reference(s)` and
passes normalized step values to `gauge.showReferences`. Multiple aliases on one
step annotation produce one CodeLens per alias. The VS Code Kotlin provider used
a fixed `Find Step References` title and grouped all aliases into a single
command argument.

## RED

Command:

```text
node --test --test-name-pattern "Kotlin Step functions|separate reference lenses|Java Step methods" test/codeLensProvider.test.js
```

Result:

```text
pass 0
fail 3
step CodeLens titles were fixed
step command arguments used raw alias values
multiple aliases were grouped into one CodeLens
```

## GREEN

Command:

```text
node --test --test-name-pattern "Kotlin Step functions|separate reference lenses|Java Step methods" test/codeLensProvider.test.js
```

Result:

```text
pass 3
fail 0
```

## Focused Check

Command:

```text
node --test test/codeLensProvider.test.js
```

Result:

```text
pass 14
fail 0
```

## Broad Check

Command:

```text
npm run check
```

Result:

```text
typecheck pass
lint pass
test:unit pass 833 fail 0
test:lsp pass 32 fail 0
test:vscode pass 46 fail 0
package pass
```
