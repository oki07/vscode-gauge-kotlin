# Empty LSP Step References TDD Evidence

## Scope

Step reference lookup must preserve an empty list returned by the Gauge LSP.
An empty list is an authoritative "no references" result and must not be
augmented with local Gauge document fallback results.

## Source-only Reference Context

- `references/gauge-vscode/src/gaugeReference.ts` passes the
  `gauge/stepReferences` result directly to `editor.action.showReferences`
  when the language server returns a location array.
- `vscode-gauge-kotlin/src/gaugeReference.js` previously treated `[]` like
  `null` or `undefined`, then searched local Gauge documents and showed those
  fallback references instead.

## RED

Command:

```sh
node --test --test-name-pattern "preserves empty LSP reference results" test/gaugeReference.test.js
```

Result:

- Passed: 0
- Failed: 1

Failure summary:

- `ReferenceProvider preserves empty LSP reference results without local
  fallback` expected `editor.action.showReferences` to receive `[]`, but the
  provider inserted a matching local spec location.

## GREEN

Command:

```sh
node --test --test-name-pattern "preserves empty LSP reference results" test/gaugeReference.test.js
```

Result:

- Passed: 1
- Failed: 0

Focused check:

```sh
node --test test/gaugeReference.test.js
```

Result:

- Passed: 29
- Failed: 0

Broader check:

```sh
npm run check
```

Result:

- Unit tests passed: 855
- LSP tests passed: 32
- VS Code extension tests passed: 48
- Failed: 0
- Package completed.

## Implementation Notes

- `referenceLocationsForStep` now returns array responses from the language
  server as-is, including empty arrays.
- `referenceLocationsForStepValues` preserves an all-empty array aggregate as
  `[]` instead of collapsing it to `undefined`.
- `null` or `undefined` LSP responses still use the existing local Gauge
  fallback behavior.
