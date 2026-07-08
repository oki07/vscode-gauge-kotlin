# Rename Compile Preflight TDD Evidence

## Scope

Rename/refactor should run a build-tool compile preflight before sending the
Gauge rename request. If the project does not compile, rename must stop with
the standard refactor preflight error.

## Source-only Reference Context

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/rename/GaugeRefactorHandler.java`
  calls `CompilerManager.make` before refactor and stops when compiler errors
  are reported.
- `vscode-gauge-kotlin/src/renameProvider.js` already saved files and checked
  diagnostics and Gauge validation, but did not run build-tool compile before
  `textDocument/rename`.

## RED

Command:

```sh
node --test --test-name-pattern "Maven compile preflight fails" test/renameProvider.test.js
```

Result:

- Passed: 0
- Failed: 1

Failure summary:

- `GaugeRenameProvider rejects language server renames when Maven compile
  preflight fails` did not reject because rename reached the language server
  without running Maven compile.

## GREEN

Command:

```sh
node --test --test-name-pattern "Maven compile preflight fails" test/renameProvider.test.js
```

Result:

- Passed: 1
- Failed: 0

Focused check:

```sh
node --test test/renameProvider.test.js
```

Result:

- Passed: 31
- Failed: 0

Broader check:

```sh
npm run check
```

Result:

- Unit tests passed: 854
- LSP tests passed: 32
- VS Code extension tests passed: 48
- Failed: 0
- Package completed.

## Implementation Notes

- Added a rename compile preflight after `saveAll` and before diagnostics,
  Gauge validation, or LSP rename.
- Maven projects run `mvn -q compile test-compile`.
- Gradle projects run `gradle clean testClasses` or the project wrapper command
  exposed by the project model.
- Generic Gauge projects without build-tool compile support keep the existing
  diagnostics and validation preflight behavior.
