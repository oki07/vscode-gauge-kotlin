# Rename Workspace Scan Project Gate

## Source behavior

Gauge rename scans workspace Gauge files and step implementation files so a step rename can update specifications, concepts, Kotlin annotations, Java annotations, and constant-backed step text. That scan must stay inside known Gauge project roots, matching IntelliJ rename availability checks for non-Gauge files and the existing project-root gates for definition, reference, CodeLens, diagnostics, and validate refresh scans.

## RED

Command:

```sh
node --test --test-name-pattern "does not open unopened files outside Gauge projects" test/renameProvider.test.js
```

Result: failed. `GaugeRenameProvider does not open unopened files outside Gauge projects during workspace scans` observed `/workspace/notes/example.md` opened once for each workspace scan pattern, proving rename loaded non-Gauge workspace files before project filtering.

## GREEN

Command:

```sh
node --test --test-name-pattern "does not open unopened files outside Gauge projects" test/renameProvider.test.js
```

Result: passed. The provider now checks each URI's resolved root with the shared diagnostics project gate before opening unopened workspace files.

## Broader Check

Command:

```sh
node --test test/renameProvider.test.js
```

Result: passed with 22 tests.
