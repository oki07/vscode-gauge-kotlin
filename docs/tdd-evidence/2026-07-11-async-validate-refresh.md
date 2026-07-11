# Asynchronous Gauge validation refresh

## Scope

Keep the extension host responsive while Gauge validation diagnostics refresh
after specification and concept documents open, save, or close.

## Runtime evidence

Cursor 3.11.13 reported the user extension host as unresponsive from 16:59:02
until the window closed at 17:00:25. The active Maven Gauge project contained
436 Gauge log directories after repeated document navigation.

One direct project measurement took 1.29 seconds for `mvn -q gauge:classpath`
and 2.56 seconds for `gauge validate`. The validation provider ran both through
synchronous child processes. Its workspace scan also opened unopened Gauge
documents, whose open events could start overlapping full refreshes.

## RED

Command:

```sh
node --test --test-name-pattern "coalesces concurrent workspace refreshes|runs Gauge validation without blocking refresh" test/validateDiagnostics.test.js
```

Result: failed with 0 passing and 2 failing tests. Concurrent refresh calls
returned different promises, and workspace refresh did not call asynchronous
`spawn`.

## GREEN

Commands:

```sh
node --test --test-name-pattern "coalesces concurrent workspace refreshes|runs Gauge validation without blocking refresh" test/validateDiagnostics.test.js
node --test test/validateDiagnostics.test.js
```

Result: passed with 2 selected tests and all 14 validation diagnostics tests.

Broader command:

```sh
npm run check
```

Result: passed with all unit, LSP, and VS Code surface tests, syntax and lint
checks, and a successful VSIX package dry run.

## Implementation

- Coalesce overlapping validation refresh requests into one in-flight promise.
- Run automatic `gauge validate` refreshes through the asynchronous command
  spawn API while preserving the synchronous direct diagnostics API.
- Cache the calculated project environment by Gauge project root so navigation
  does not rerun Maven classpath calculation.
- Share one validation promise per project across all documents in a refresh.

## Real-project verification

The first asynchronous refresh completed in 4.90 seconds with a maximum event
loop delay of 1.25 seconds. A cached refresh completed in 3.58 seconds with a
maximum event loop delay of 11 milliseconds. Both remain responsive while the
external Gauge process continues.

Local definition resolution returned the concept heading from a specification
step in 61 milliseconds and returned the Kotlin Step declarations from concept
steps in 27 milliseconds and 25 milliseconds.
