# Definition Source Scan Project Gate

## Source behavior

Step definition workspace scans must stay within Gauge projects. When workspace discovery finds unopened Kotlin, Java, or concept files, the provider must reject files whose resolved root is not a Gauge project before opening them. Unknown roots remain available for the existing external fallback path.

## RED

Command:

```sh
node --test test/stepDefinitionProvider.test.js --test-name-pattern "unopened Step sources"
```

Result: failed. `GaugeStepDefinitionProvider skips unopened Step sources resolved to non-Gauge projects` opened `/workspace/notes/src/test/kotlin/OtherSteps.kt` even though `projectFactory.isGaugeProject("/workspace/notes")` returned `false`.

## GREEN

Command:

```sh
node --test test/stepDefinitionProvider.test.js --test-name-pattern "unopened Step sources"
```

Result: passed. The provider now rejects non-Gauge source URIs before `workspace.openTextDocument` while preserving the in-project definition result.

## Broader Check

Command:

```sh
node --test test/stepDefinitionProvider.test.js
```

Result: passed. All step definition provider tests remained green with 28 passing tests.
