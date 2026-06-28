# Gauge Validate Diagnostics

## Behavior

Gauge documents must surface `gauge validate` errors as VS Code diagnostics for the matching spec or concept file.

## RED

Command:

```sh
node --test test/validateDiagnostics.test.js test/extension.test.js --test-name-pattern "ValidateDiagnostics|validate diagnostics"
```

Result: failed. `src/validateDiagnostics.js` was missing, and activation did not register a validate diagnostics provider.

## GREEN

Command:

```sh
node --test test/validateDiagnostics.test.js test/extension.test.js --test-name-pattern "ValidateDiagnostics|validate diagnostics|Gauge workspace services for Gauge projects"
```

Result: passed.
