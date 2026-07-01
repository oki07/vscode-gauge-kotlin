# Reference Source Scan Project Gate

## Source behavior

Reference lookup source scans must stay within Gauge projects. When workspace discovery finds unopened Kotlin or Java step source files, the reference provider must reject files whose resolved root is not a Gauge project before opening them. It must also keep local Gauge reference scans scoped to the source Gauge project.

## RED

Command:

```sh
node --test test/gaugeReference.test.js --test-name-pattern "unopened Step sources"
```

Result: failed. `ReferenceProvider skips unopened Step sources resolved to non-Gauge projects` opened `/workspace/notes/src/test/kotlin/OtherSteps.kt` even though `projectFactory.isGaugeProject("/workspace/notes")` returned `false`.

## GREEN

Command:

```sh
node --test test/gaugeReference.test.js --test-name-pattern "unopened Step sources"
```

Result: passed. The provider now skips non-Gauge source URIs before `workspace.openTextDocument` while preserving the active step reference lookup.

## Broader Check

Command:

```sh
node --test test/gaugeReference.test.js
```

Result: passed. All reference provider tests remained green with 25 passing tests.
