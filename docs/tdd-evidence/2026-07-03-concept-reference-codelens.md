# Concept Reference CodeLens

## Reference Sources

- `references/gauge-lsp-tests/specifications/codelens/findConceptUsages.json`
- `references/gauge-lsp-tests/specifications/codelens/findUsages.spec`
- `references/gauge-lsp-tests/data/find-usages/specifications/concepts.cpt`
- `references/gauge-vscode/src/gaugeWorkspace.ts`

## Gap

Gauge LSP provides reference CodeLens entries on concept headings with
`N reference(s)` titles and `gauge.showReferences` arguments containing the
concept document URI, heading position, and normalized concept step value. The
VS Code Kotlin provider ignored concept documents and the activation selector
did not explicitly include `.cpt` files for CodeLens.

## RED

Command:

```text
node --test --test-name-pattern "concept headings|run code lenses" test/codeLensProvider.test.js test/extension.test.js
```

Result:

```text
pass 0
fail 2
concept documents returned no reference CodeLens entries
CodeLens selector did not include **/*.cpt
```

## GREEN

Command:

```text
node --test --test-name-pattern "concept headings|run code lenses" test/codeLensProvider.test.js test/extension.test.js
```

Result:

```text
pass 2
fail 0
```

## Focused Check

Command:

```text
node --test test/codeLensProvider.test.js test/extension.test.js
```

Result:

```text
pass 47
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
test:unit pass 832 fail 0
test:lsp pass 32 fail 0
test:vscode pass 46 fail 0
package pass
```
