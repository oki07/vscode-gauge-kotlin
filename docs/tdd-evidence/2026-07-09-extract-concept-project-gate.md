# Extract Concept Project Gate

## Reference behavior

- IntelliJ enables Extract Concept only when the current file belongs to a Gauge module and is a Gauge file.
- The target provider allowed `languageId: "gauge"` documents to reach the concept-name prompt without a resolved Gauge project.

## RED

Command:

```sh
node --test test/extractConcept.test.js
```

Result:

- Failed 1 test:
  - `ExtractConceptCommandProvider rejects Gauge documents without a project before prompting`

## GREEN

Command:

```sh
node --test test/extractConcept.test.js
```

Result:

- Passed 33 tests.

Related command:

```sh
node --test test/extractConcept.test.js test/extension.test.js
```

Result:

- Passed 70 tests.

Broad check:

```sh
npm run check
```

Result:

- Passed typecheck, lint, unit tests, LSP tests, VS Code tests, and package.
- Unit tests: 909 passed.
- LSP tests: 33 passed.
- VS Code tests: 51 passed.

## Implementation

- Required a resolved project client for every Extract Concept source document, including documents already tagged with the `gauge` language id.
- Rejected non-project Gauge documents before concept-name input or concept-file selection.
