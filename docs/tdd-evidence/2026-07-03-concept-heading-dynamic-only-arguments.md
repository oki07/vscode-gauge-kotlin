# Concept Heading Dynamic-Only Arguments TDD Evidence

## Scope

- Parity item: source-only follow-up from the IntelliJ and Gauge runtime language/editor audit.
- Reference behavior: concept headings accept dynamic `<arg>` parameters only. Quoted text in a concept heading is not a static Gauge argument.
- Reference paths:
  - `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_ConceptLexer.flex`
  - `references/intellij-gauge-plugin/src/concept.bnf`
  - `references/gauge/parser/conceptParser.go`
- Target behavior: concept heading quotes remain plain heading text for completion and semantic highlighting, and TextMate heading patterns keep only dynamic arguments reachable.

## RED

- Test paths:
  - `test/dynamicArgumentCompletion.test.js`
  - `test/semanticTokensProvider.test.js`
  - `test/manifest.test.js`
- Commands:
  - `node --test --test-name-pattern "concept heading static arguments" test/dynamicArgumentCompletion.test.js`
  - `node --test --test-name-pattern "quoted concept heading text" test/semanticTokensProvider.test.js`
  - `node --test --test-name-pattern "only dynamic arguments reachable" test/manifest.test.js`
- Result: all three commands failed.
- Failure summary:
  - Dynamic completion still offered `cart`, `ca`, and `card` inside a quoted concept heading argument.
  - Semantic tokens still emitted an `argument` token for quoted concept heading text.
  - TextMate hash heading grammar still included `#arguments`, which includes quoted static arguments.

## Implementation

- Production files:
  - `src/dynamicArgumentCompletion.js`
  - `src/semanticTokensProvider.js`
  - `syntaxes/gauge.tmLanguage.json`
- Summary:
  - Limited static argument completion and collection to step lines.
  - Used dynamic-only argument tokenization for concept hash headings.
  - Added a dynamic-only TextMate argument repository and used it from hash heading patterns.

## GREEN

- Commands:
  - `node --test --test-name-pattern "concept heading static arguments" test/dynamicArgumentCompletion.test.js`
  - `node --test --test-name-pattern "quoted concept heading text" test/semanticTokensProvider.test.js`
  - `node --test --test-name-pattern "only dynamic arguments reachable" test/manifest.test.js`
- Result: all three commands passed with 1 selected test each.
- Related checks:
  - `node --test test/dynamicArgumentCompletion.test.js`
  - `node --test test/semanticTokensProvider.test.js`
  - `node --test test/manifest.test.js`
- Result: passed with 45, 30, and 11 tests respectively.

## Broader Check

- Command: `npm run check`
- Result: passed.
- Output summary: `test:unit` passed with 799 tests, `test:lsp` passed with 32 tests, `test:vscode` passed with 44 tests, and package dry-run completed.
