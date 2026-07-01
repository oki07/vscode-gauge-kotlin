# CodeLens Source Scan Project Gate

## Source behavior

Reference CodeLens source scans must stay within Gauge projects. When workspace discovery finds unopened Kotlin or Java step source files, the provider must check the resolved root before opening the document, and skip files whose root is not a Gauge project.

## RED

Command:

```sh
node --test test/codeLensProvider.test.js --test-name-pattern "unopened Step sources"
```

Result: failed. `GaugeCodeLensProvider skips unopened Step sources resolved to non-Gauge projects` opened `/workspace/notes/src/test/kotlin/OtherSteps.kt` even though `projectFactory.isGaugeProject("/workspace/notes")` returned `false`.

## GREEN

Command:

```sh
node --test test/codeLensProvider.test.js --test-name-pattern "unopened Step sources"
```

Result: passed. The provider now skips the non-Gauge source URI before calling `workspace.openTextDocument`.

## Broader Check

Command:

```sh
node --test test/codeLensProvider.test.js
```

Result: passed. All CodeLens provider tests remained green with 11 passing tests.
