# Debug Sort Schema

## Scope

- Reference source: `references/gauge-vscode/package.json`
- Reference source: `references/gauge-vscode/src/execution/runArgs.ts`
- Target source: `package.json`
- Test source: `test/manifest.test.js`
- Test source: `test/execution/runArgs.test.js`

## RED

Command:

```sh
node --test test/manifest.test.js
```

Result:

- Failed 1 test.
- `extension manifest exposes the core Gauge VS Code surface for Kotlin projects`

Reason:

- The debug launch `sort` schema accepted only string values, rejecting the reference-compatible boolean `sort: true` launch configuration shape.

## GREEN

Command:

```sh
node --test test/manifest.test.js test/execution/runArgs.test.js
```

Result:

- Passed 50 tests.

Implementation:

- Allowed debug launch `sort` to be either boolean or `alpha` / `random`.
- Kept runtime argument generation compatible with boolean `sort: true`.
