# Markdown Step Diagnostics Project Gate

## Source behavior

Step diagnostics may analyze Gauge specification, concept, Kotlin, and Java step files that belong to Gauge projects. Ordinary Markdown files must not produce Gauge undefined-step diagnostics when root discovery resolves to a directory that is not a Gauge project.

## RED

Command:

```sh
node --test test/stepDiagnostics.test.js --test-name-pattern "resolved root"
```

Result: failed. `GaugeStepDiagnosticsProvider ignores Markdown when the resolved root is not a Gauge project` reported an `Undefined Step` diagnostic for `/workspace/notes/checkout.md`, proving `isGaugeProject(root) === false` was ignored after root discovery succeeded.

## GREEN

Command:

```sh
node --test test/stepDiagnostics.test.js --test-name-pattern "resolved root"
```

Result: passed. The provider now uses a shared root gate that checks `projectFactory.isGaugeProject(root)` when available and filters both active diagnostics and workspace scans for non-Gauge roots.

## Broader Check

Command:

```sh
node --test test/stepDiagnostics.test.js
```

Result: passed. All step diagnostics tests remained green.
