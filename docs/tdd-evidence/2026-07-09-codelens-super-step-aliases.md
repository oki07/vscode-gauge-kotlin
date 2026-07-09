# CodeLens Super Step Aliases

## Reference behavior

- IntelliJ `StepFindUsagesHandler` includes super methods when searching implementation usages.
- Target `ReferenceProvider` already included super step aliases for implementation references.
- Target `GaugeCodeLensProvider` only counted aliases declared directly on the current step implementation.

## RED

Command:

```sh
node --test test/codeLensProvider.test.js
```

Result:

- Failed 2 tests:
  - `GaugeCodeLensProvider includes Kotlin super Step aliases in implementation lenses`
  - `GaugeCodeLensProvider includes Java super Step aliases in implementation lenses`

## GREEN

Command:

```sh
node --test test/codeLensProvider.test.js
```

Result:

- Passed 20 tests.

Related command:

```sh
node --test test/codeLensProvider.test.js test/gaugeReference.test.js test/stepDefinitionProvider.test.js
```

Result:

- Passed 84 tests.

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

- Exported the existing super step alias resolver from `src/gaugeReference.js`.
- Reused it from `src/codeLensProvider.js` so implementation CodeLens entries include aliases from inherited Kotlin and Java step declarations.
