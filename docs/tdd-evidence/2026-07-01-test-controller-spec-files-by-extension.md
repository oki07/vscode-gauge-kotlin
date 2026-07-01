# Test Controller Spec Files By Extension

## Scope

Gauge Test UI discovery should treat `.spec` files as Gauge specifications even
when VS Code has not associated the document with the `gauge` language yet. This
keeps Test Explorer discovery consistent with the extension's file association
and provider parity work for Gauge specification files.

## Reference Paths

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileTypeFactory.java`
- `references/gauge-vscode/src/gaugeWorkspace.ts`
- `references/gauge/api/lang/symbols.go`

## RED

Command:

```text
node --test --test-name-pattern "spec files by extension" test/testController.test.js
```

Result: failed with 1 selected test. `GaugeTestController discovers specification
and scenario test items from open spec files by extension` could not read the
spec label because the open plaintext `.spec` document produced no TestItem.

## GREEN

Command:

```text
node --test --test-name-pattern "spec files by extension" test/testController.test.js
```

Result: passed with 1 selected test.

## Broader Checks

Commands:

```text
node --test test/testController.test.js
npm run check
```

Results:

- `node --test test/testController.test.js` passed with 31 tests.
- `npm run check` passed: `test:unit` 782 tests, `test:lsp` 28 tests,
  `test:vscode` 41 tests, and package dry-run completed.

## Implementation

- Added `.spec` path recognition to open-document Test UI discovery.
- Kept `.cpt` concept files excluded from specification and scenario TestItems.
- Kept existing project-root gating through `projectFactory` when available.
