# Diagnostics refresh scan coalescing

Reference behavior:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/annotator/StepAnnotator.java` and `ParamAnnotator.java` annotate PSI/module-local elements instead of starting a full workspace file scan for every document event.
- The VS Code implementation must still discover unopened Gauge, Kotlin, Java, and concept files, but repeated refresh requests should not duplicate an in-flight scan.

Target behavior:
- Concurrent `GaugeStepDiagnosticsProvider.refreshDocuments` calls reuse the same in-flight workspace scan.
- After the scan finishes, the pending scan is cleared so later refreshes can rescan current workspace state.
- Current open documents are merged with the shared scan result before diagnostics are computed.

RED:
- `node --test test/stepDiagnostics.test.js --test-name-pattern "in-flight workspace scan"`
- Result: failed before implementation because two concurrent refreshes called `workspace.findFiles` twice.

GREEN:
- `node --test test/stepDiagnostics.test.js --test-name-pattern "in-flight workspace scan"`
- `node --test test/stepDiagnostics.test.js`
- Result: passed after implementation.
