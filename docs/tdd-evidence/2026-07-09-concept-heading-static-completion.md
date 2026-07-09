# Concept Heading Static Completion

## Reference behavior

- IntelliJ registers `ConceptStaticArgCompletionProvider` for concept `ARG` tokens.
- `ConceptStaticArgCompletionProvider` collects static arguments from the whole concept file.
- The target provider only allowed quoted static argument completion on step lines, so concept headings could not complete static arguments.

## RED

Command:

```sh
node --test test/dynamicArgumentCompletion.test.js
```

Result:

- Failed 1 test:
  - `GaugeDynamicArgumentCompletionProvider suggests concept heading static arguments`

## GREEN

Command:

```sh
node --test test/dynamicArgumentCompletion.test.js
```

Result:

- Passed 66 tests.

Related command:

```sh
node --test test/dynamicArgumentCompletion.test.js test/extension.test.js
```

Result:

- Passed 103 tests.

Broad check:

```sh
npm run check
```

Result:

- Passed typecheck, lint, unit tests, LSP tests, VS Code tests, and package.
- Unit tests: 908 passed.
- LSP tests: 33 passed.
- VS Code tests: 51 passed.

## Implementation

- Allowed static argument completion inside concept headings.
- Included concept heading quoted arguments in concept static argument completion candidates.
