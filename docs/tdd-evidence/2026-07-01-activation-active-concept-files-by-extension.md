# Activation Active Concept Files By Extension

## Scope

Extension activation should start Gauge services when the active editor is a
`.cpt` concept file, even if VS Code has not associated the editor with the
`gauge` language yet. Without this activation gate, provider registrations and
the Gauge workspace are not created for a concept-only editing session.

## Reference Paths

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileTypeFactory.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/ConceptFileType.java`
- `references/gauge-vscode/src/gaugeWorkspace.ts`

## RED

Command:

```text
node --test --test-name-pattern "active concept file by extension" test/extension.test.js
```

Result: failed with 1 selected test. Activation did not create
`GaugeWorkspace` for a plaintext active `.cpt` document.

## GREEN

Command:

```text
node --test --test-name-pattern "active concept file by extension" test/extension.test.js
```

Result: passed with 1 selected test.

## Broader Checks

Commands:

```text
node --test test/extension.test.js
npm run check
```

Results:

- `node --test test/extension.test.js` passed with 31 tests.
- `npm run check` passed: `test:unit` 787 tests, `test:lsp` 32 tests,
  `test:vscode` 42 tests, and package dry-run completed.

## Implementation

- Added `.cpt` path recognition to activation's active Gauge document check.
- Reused the existing active Gauge service startup flow.
- Left Markdown activation project gating unchanged.
