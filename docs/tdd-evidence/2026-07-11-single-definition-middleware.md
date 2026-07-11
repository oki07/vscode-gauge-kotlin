# Single Gauge definition middleware

## Scope

Preserve direct specification and concept navigation to Kotlin Step functions
without returning duplicate definition locations.

## Root cause

The extension registered two VS Code definition providers for the same Gauge
documents: the provider created by `vscode-languageclient` and a standalone
local provider. Making the standalone provider return an empty list when a
client existed removed duplicate results but also left incomplete LSP results
in control. In Maven projects whose Gauge manifest uses the Java runner while
Step sources are Kotlin, that could suppress the valid local Kotlin definition.

The correct ownership model is one registered definition provider. The Gauge
language client middleware performs local source resolution first and delegates
to Gauge LSP only when no local definition exists.

## RED

Commands:

```sh
node --test --test-name-pattern "leaves Gauge definition ownership to language client middleware" test/extension.test.js
node --test --test-name-pattern "suppresses external implementation definition errors" test/gaugeWorkspace.test.js
```

Result: both selected tests failed. Activation still registered a second local
definition provider, and middleware returned a remote result instead of the
available local Kotlin Step definition.

## GREEN

Commands:

```sh
node --test --test-name-pattern "leaves Gauge definition ownership to language client middleware" test/extension.test.js
node --test --test-name-pattern "suppresses external implementation definition errors" test/gaugeWorkspace.test.js
node --test test/stepDefinitionProvider.test.js test/gaugeWorkspace.test.js test/extension.test.js
```

Result: both selected tests passed and the combined definition, workspace, and
activation suite passed with 103 tests. The middleware integration test also
resolved a Gauge specification step directly to its Kotlin Step declaration
without invoking the remote provider.

Broader command:

```sh
npm run check
```

Result: passed with 1,004 unit tests, 33 LSP tests, 53 VS Code surface tests,
syntax and lint checks, and a successful VSIX package dry run.

## Implementation

- Remove standalone local definition provider registration from extension
  activation.
- Use the language client middleware as the sole registered definition owner.
- Return local Kotlin, Java, or concept definitions before requesting Gauge LSP.
- Delegate to Gauge LSP only when local resolution returns no definitions.
- Suppress external implementation errors only when neither path resolves a
  source location.

This supersedes the client-presence suppression approach documented in
`2026-07-11-definition-provider-ownership.md`.
