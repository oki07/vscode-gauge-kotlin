# Validate Refresh Scan Project Gate

## Source behavior

Gauge validation refresh scans workspace `.spec`, `.md`, and `.cpt` files so diagnostics can be populated for unopened Gauge files. The scan must stay inside known Gauge project roots, matching IntelliJ annotator behavior that skips non-Gauge modules and the existing Markdown validate project gate.

## RED

Command:

```sh
node --test --test-name-pattern "does not open unopened files outside Gauge projects" test/validateDiagnostics.test.js
```

Result: failed. `GaugeValidateDiagnosticsProvider does not open unopened files outside Gauge projects during refresh` observed `/workspace/notes/example.md` in `openTextDocument`, proving the refresh scan opened a non-Gauge workspace file before project filtering.

## GREEN

Command:

```sh
node --test --test-name-pattern "does not open unopened files outside Gauge projects" test/validateDiagnostics.test.js
```

Result: passed. The provider now checks the URI's resolved root with `projectFactory.getGaugeRootFromFilePath` and `projectFactory.isGaugeProject` before opening unopened workspace files.

## Broader Check

Command:

```sh
node --test test/validateDiagnostics.test.js
```

Result: passed with 9 tests.
