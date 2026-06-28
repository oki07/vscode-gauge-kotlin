# Markdown spec diagnostics

## Scope

Treat `.md` Gauge specification files as Gauge specs for diagnostics, validation, and undefined-step quick fixes even when VS Code reports the document language as `markdown`.

Reference source:

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileTypeFactory.java`

Target source:

- `src/stepDiagnostics.js`
- `src/validateDiagnostics.js`
- `src/stepCodeActions.js`
- `test/stepDiagnostics.test.js`
- `test/validateDiagnostics.test.js`
- `test/stepCodeActions.test.js`

## RED

Command:

```sh
node --test --test-name-pattern "markdown Gauge spec|markdown specs" test/stepDiagnostics.test.js test/validateDiagnostics.test.js test/stepCodeActions.test.js
```

Result: failed as expected, 0/3 tests passed.

Observed failures:

- Markdown `.md` specs did not receive undefined-step diagnostics.
- Markdown `.md` specs did not receive `gauge validate` diagnostics.
- Markdown `.md` specs did not receive create-step quick fixes.

## GREEN

Command:

```sh
node --test --test-name-pattern "markdown Gauge spec|markdown specs" test/stepDiagnostics.test.js test/validateDiagnostics.test.js test/stepCodeActions.test.js
```

Result: passed, 3/3 tests.

Related command:

```sh
node --test test/stepDiagnostics.test.js test/validateDiagnostics.test.js test/stepCodeActions.test.js test/extension.test.js
```

Result: passed, 224/224 tests.

## Broader checks

Command:

```sh
npm run check
```

Result: passed. Unit tests passed 609/609, LSP tests passed 22/22, VS Code tests passed 26/26, and package creation succeeded.
