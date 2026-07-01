# LSP Active Concept Files By Extension

## Scope

Gauge workspace startup should recognize an active `.cpt` concept file even
when VS Code has not associated the editor with the `gauge` language yet. This
keeps concept files on the same LSP startup path as `.spec` files and Markdown
Gauge specifications.

## Reference Paths

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileTypeFactory.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/ConceptFileType.java`
- `references/gauge-vscode/src/gaugeWorkspace.ts`

## RED

Command:

```text
node --test --test-name-pattern "concept file by extension" test/gaugeWorkspace.test.js
```

Result: failed with 2 selected tests. `GaugeWorkspace` did not start a client
for a plaintext active `.cpt` editor on startup or after active editor changes.

## GREEN

Command:

```text
node --test --test-name-pattern "concept file by extension" test/gaugeWorkspace.test.js
```

Result: passed with 2 selected tests.

## Broader Checks

Commands:

```text
node --test test/gaugeClients.test.js test/gaugeWorkspace.test.js
npm run check
```

Results:

- `node --test test/gaugeClients.test.js test/gaugeWorkspace.test.js` passed
  with 32 tests.
- `npm run check` passed: `test:unit` 786 tests, `test:lsp` 32 tests,
  `test:vscode` 41 tests, and package dry-run completed.

## Implementation

- Added `.cpt` path recognition to active Gauge workspace document detection.
- Kept Markdown `.md` Gauge specification detection language-gated to Markdown.
- Reused existing project-root resolution and startup flow.
