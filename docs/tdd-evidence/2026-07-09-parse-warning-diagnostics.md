# Parse warning diagnostics

## Reference source

- `references/gauge/api/lang/diagnostics.go`
- `references/gauge/parser/parse.go`

Gauge keeps parse warnings separate from parse errors in LSP diagnostics, using
warning severity for `ParseResult.Warnings`. CLI validation output prefixes
these warning lines with `[ParseWarning]`.

## RED

Command:

```sh
node --test test/validateDiagnostics.test.js -t "GaugeValidateDiagnosticsProvider maps parse warnings to warning diagnostics"
```

Result: failed. The provider emitted an error diagnostic for `[ParseWarning]`
output instead of warning severity.

## GREEN

Command:

```sh
node --test test/validateDiagnostics.test.js -t "GaugeValidateDiagnosticsProvider maps parse warnings to warning diagnostics"
```

Result: passed.

## Regression

Command:

```sh
node --test test/validateDiagnostics.test.js
```

Result: passed, 11 tests.

Command:

```sh
npm run check
```

Result: passed.
