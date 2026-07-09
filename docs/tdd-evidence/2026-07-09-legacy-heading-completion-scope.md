# Legacy Heading Completion Scope

## Scope

- Reference source: `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_SpecLexer.flex`
- Reference source: `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_ConceptLexer.flex`
- Reference source: `references/gauge/parser/conceptParser.go`
- Target source: `src/dynamicArgumentCompletion.js`
- Test source: `test/dynamicArgumentCompletion.test.js`

## RED

Command:

```sh
node --test test/dynamicArgumentCompletion.test.js
```

Result:

- Failed 2 tests.
- `GaugeDynamicArgumentCompletionProvider suggests legacy scenario data table headers`
- `GaugeDynamicArgumentCompletionProvider suggests legacy concept heading dynamic arguments`

Reason:

- Legacy underline scenario headings were not used as scenario data table scope boundaries.
- Legacy underline concept headings were not used as dynamic argument sources or completion locations.

## GREEN

Command:

```sh
node --test test/dynamicArgumentCompletion.test.js
```

Result:

- Passed 68 tests.

Implementation:

- Added line-aware legacy scenario and concept heading detection to dynamic argument completion.
- Applied that detection to spec table headers, scenario table headers, concept dynamic argument collection, and concept heading completion allowance.
