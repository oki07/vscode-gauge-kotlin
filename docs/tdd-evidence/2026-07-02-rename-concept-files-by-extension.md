# Rename Concept Files By Extension

## Scope

Gauge rename must work when a concept file is opened by `.cpt` extension even if VS Code reports it as plaintext. Renaming a concept heading from that file should rename matching spec usages and the concept heading itself.

## References

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileTypeFactory.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/ConceptFileType.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/rename/CustomRenameHandler.java`

## RED

Command:

```sh
node --test --test-name-pattern "concept files by extension" test/renameProvider.test.js
```

Result:

- Failed with 1 selected test.
- Failure: `prepareRename` returned `undefined` for a plaintext `.cpt` concept heading, so the test could not read the prepared rename range.

## GREEN

Command:

```sh
node --test --test-name-pattern "concept files by extension" test/renameProvider.test.js
```

Result:

- Passed with 1 selected test.

## Broader Checks

Command:

```sh
node --test test/renameProvider.test.js
npm run check
```

Result:

- Passed with 24 tests.
- `npm run check` passed with `test:unit` 789 tests, `test:lsp` 32 tests, `test:vscode` 43 tests, and package dry-run success.

## Implementation

- Added `.cpt` extension detection to the rename provider Gauge document gate.
- Registered the rename provider for `**/*.cpt` files.
- Added coverage for concept-heading rename started from a plaintext `.cpt` document.
