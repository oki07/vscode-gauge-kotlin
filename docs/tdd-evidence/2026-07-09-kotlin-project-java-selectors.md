# Kotlin Project Java Selectors

## Scope

- Reference source: `references/kotlin-lsp/vscode-extension-core/src/lspClient.ts`
- Reference source: `references/kotlin-lsp/workspace-import/test/testData/gradle/MultiProjectKotlinDSL/workspace.json`
- Target source: `src/gaugeWorkspace.js`
- Test source: `test/gaugeWorkspace.test.js`

## RED

Command:

```sh
node --test test/gaugeWorkspace.test.js
```

Result:

- Failed 2 tests.
- `GaugeWorkspace starts Gauge LSP clients for workspace projects`
- `GaugeWorkspace starts a client for the active Markdown Gauge specification`

Reason:

- Kotlin Gauge project client options included Kotlin implementation selectors but did not include Java implementation selectors.

## GREEN

Command:

```sh
node --test test/gaugeWorkspace.test.js
```

Result:

- Passed 29 tests.

Implementation:

- Added Java language and `.java` file selectors to Kotlin project Gauge LSP client options.
- Kept Java project config generation gated to Java runner projects only.
