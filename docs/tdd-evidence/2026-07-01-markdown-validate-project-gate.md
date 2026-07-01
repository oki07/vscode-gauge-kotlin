# Markdown Validate Project Gate

## Source behavior

Gauge validation diagnostics may run `gauge validate` for Gauge specification, concept, and Markdown specification files inside Gauge projects. Ordinary Markdown files must not start validation when the resolved root is not a Gauge project.

## RED

Command:

```sh
node --test test/validateDiagnostics.test.js --test-name-pattern "resolved root"
```

Result: failed. `GaugeValidateDiagnosticsProvider ignores Markdown when the resolved root is not a Gauge project` still called `spawnSync(["validate"], { cwd: "/workspace/notes", ... })`, proving validation reached the Gauge CLI path for a non-Gauge Markdown file.

## GREEN

Command:

```sh
node --test test/validateDiagnostics.test.js --test-name-pattern "resolved root"
```

Result: passed. The provider now checks resolved project roots with `projectFactory.isGaugeProject(root)` when available and returns no diagnostics before CLI execution for non-Gauge Markdown roots.

## Broader Check

Command:

```sh
node --test test/validateDiagnostics.test.js
```

Result: passed. All validate diagnostics tests remained green.
