# Gauge definition provider ownership

## Scope

Return one definition location when Gauge LSP and the local Kotlin fallback can
resolve the same specification or concept step.

## Runtime evidence

Cursor displayed `Definitions (2)` for one concept heading. Gauge LSP registered
its definition provider through the language client, while the extension also
registered `GaugeStepDefinitionProvider` for the same Gauge documents. Both
providers returned the same location, so Cursor opened a multiple-definition
peek instead of navigating directly.

## RED

Commands:

```sh
node --test --test-name-pattern "defers to the active Gauge language client" test/stepDefinitionProvider.test.js
node --test --test-name-pattern "suppresses external implementation definition errors" test/gaugeWorkspace.test.js
```

Result: both selected tests failed. The standalone local provider returned one
definition while a Gauge language client owned the document, and the language
client middleware returned an empty result without trying the local fallback.

## GREEN

Commands:

```sh
node --test --test-name-pattern "defers to the active Gauge language client" test/stepDefinitionProvider.test.js
node --test --test-name-pattern "suppresses external implementation definition errors" test/gaugeWorkspace.test.js
node --test test/stepDefinitionProvider.test.js test/gaugeWorkspace.test.js test/extension.test.js
```

Result: both selected tests passed and the combined definition, workspace, and
activation suite passed with 104 tests.

Broader command:

```sh
npm run check
```

Result: passed with all unit, LSP, and VS Code surface tests, syntax and lint
checks, and a successful VSIX package dry run.

## Implementation

- Pass the active Gauge clients map to the standalone local definition provider.
- Return no standalone local definitions when a language client owns the source
  document, leaving the normal LSP provider as the sole result owner.
- Fall back inside language client middleware when LSP returns no definitions or
  reports an external implementation source error.
- Preserve non-empty LSP results without adding local duplicates.
