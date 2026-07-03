# Indented Step Provider Parity

## Scope

- Treat Gauge lines whose first non-whitespace character is `*` as step lines across definition, reference, CodeLens, semantic token, argument code action, extract concept, and rename providers.
- Keep indented concept hash headings and indented top-level tables on their existing non-step paths.

## RED

Command:

```sh
node --test --test-name-pattern "unopened workspace Kotlin Step functions|reference lenses for Kotlin Step functions|local references for Kotlin Step aliases|indented step markers|indented step marker arguments|indented Gauge steps|prepares indented Gauge step lines" test/stepDefinitionProvider.test.js test/codeLensProvider.test.js test/gaugeReference.test.js test/semanticTokensProvider.test.js test/argumentCodeActions.test.js test/extractConcept.test.js test/renameProvider.test.js
```

Result:

- pass 0
- fail 7

Failing checks showed that indented Gauge steps were not recognized by definition lookup, reference counting, local references, semantic tokens, argument conversions, extract concept, or rename preparation.

## GREEN

Command:

```sh
node --test --test-name-pattern "unopened workspace Kotlin Step functions|reference lenses for Kotlin Step functions|local references for Kotlin Step aliases|indented step markers|indented step marker arguments|indented Gauge steps|prepares indented Gauge step lines" test/stepDefinitionProvider.test.js test/codeLensProvider.test.js test/gaugeReference.test.js test/semanticTokensProvider.test.js test/argumentCodeActions.test.js test/extractConcept.test.js test/renameProvider.test.js
```

Result:

- pass 7
- fail 0

Focused command:

```sh
node --test test/stepDefinitionProvider.test.js test/codeLensProvider.test.js test/gaugeReference.test.js test/semanticTokensProvider.test.js test/argumentCodeActions.test.js test/extractConcept.test.js test/renameProvider.test.js
```

Result:

- pass 178
- fail 0

Broad command:

```sh
npm run check
```

Result:

- typecheck passed
- lint passed
- test:unit pass 841, fail 0
- test:lsp pass 32, fail 0
- test:vscode pass 46, fail 0
- package passed
