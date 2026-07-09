# Concept Heading Static Completion

## Scope

- Reference source: `references/intellij-gauge-plugin/src/concept.bnf`
- Reference source: `references/gauge/parser/conceptParser.go`
- Target source: `src/dynamicArgumentCompletion.js`
- Test source: `test/dynamicArgumentCompletion.test.js`

## RED

Command:

```sh
node --test test/dynamicArgumentCompletion.test.js
```

Result:

- Failed 1 test.
- `GaugeDynamicArgumentCompletionProvider ignores concept heading static arguments`

Reason:

- Concept heading quote ranges still offered static argument completions and concept heading quoted values were collected as static completion candidates.

## GREEN

Command:

```sh
node --test test/dynamicArgumentCompletion.test.js
```

Result:

- Passed 66 tests.

Implementation:

- Limited static argument completion and static argument candidate collection to step lines.
