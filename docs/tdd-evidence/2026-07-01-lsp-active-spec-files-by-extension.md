# LSP Active Spec Files By Extension

## Scope

Gauge workspace startup should recognize an active `.spec` file even when VS
Code has not associated the editor with the `gauge` language yet. This ensures
the Gauge LSP client starts for an already-open or newly-focused specification
file by extension.

## Reference Paths

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileTypeFactory.java`
- `references/gauge-vscode/src/gaugeWorkspace.ts`

## RED

Command:

```text
node --test --test-name-pattern "spec file by extension" test/gaugeWorkspace.test.js
```

Result: failed with 2 selected tests. `GaugeWorkspace` did not start a client
for a plaintext active `.spec` editor on startup or after active editor changes.

## GREEN

Command:

```text
node --test --test-name-pattern "spec file by extension" test/gaugeWorkspace.test.js
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
  with 30 tests.
- `npm run check` passed: `test:unit` 784 tests, `test:lsp` 30 tests,
  `test:vscode` 41 tests, and package dry-run completed.

## Implementation

- Added `.spec` path recognition to active Gauge workspace document detection.
- Kept Markdown `.md` Gauge specification detection language-gated to Markdown.
- Reused existing project-root resolution and startup flow.
