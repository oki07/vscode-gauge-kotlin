# Rename Save-Only Preflight

## Scope

- Parity target: Gauge rename should save workspace files before refactoring, then let the Gauge refactor engine or local rename logic decide success.
- Reference: `references/gauge/api/lang/rename.go` calls `sendSaveFilesRequest` before `renameStep`; it does not run compile, implementation diagnostics, or Gauge validate preflight gates.
- Reference: `references/gauge-vscode/src/gaugeWorkspace.proposed.ts` handles `workspace/saveFiles`.

## RED

Command:

```sh
node --test --test-name-pattern "preflight|compile before|implementation diagnostics" test/renameProvider.test.js
```

Result:

- Failed 4 tests.
- Rename was rejected by Gauge validate, Maven compile, and implementation diagnostic preflight checks before the rename request or local edits could proceed.

## GREEN

Command:

```sh
node --test --test-name-pattern "preflight|compile before|implementation diagnostics" test/renameProvider.test.js
```

Result:

- Passed 4 tests.

## Broader Checks

Commands:

```sh
node --test test/renameProvider.test.js
node --test test/renameProvider.test.js test/gaugeWorkspaceFeature.test.js test/gaugeWorkspace.test.js test/extension.test.js
```

Results:

- Passed 31 tests.
- Passed 99 tests.
