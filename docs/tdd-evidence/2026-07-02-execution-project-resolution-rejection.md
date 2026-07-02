# Execution Project Resolution Rejection

## Scope

Execution commands must not run a specification from a non-Gauge workspace
folder after project root resolution rejects the file. Workspace-folder fallback
is retained only for lightweight construction paths where no explicit project
factory was supplied.

## References

- `references/gauge-vscode/src/execution/gaugeExecutor.ts`
- `references/gauge-vscode/src/project/projectFactory.ts`
- `vscode-gauge-kotlin/src/project/projectFactory.js`

## RED

Command:

```sh
node --test --test-name-pattern "rejected by project root resolution" test/execution/executor.test.js
```

Result:

- Failed with 1 selected test.
- Failure: `gauge.execute.specification` returned `true` and executed a spec
  from `/workspace/notes/example.spec` after the explicit project factory threw
  `not a Gauge project`.

## GREEN

Command:

```sh
node --test --test-name-pattern "rejected by project root resolution" test/execution/executor.test.js
```

Result:

- Passed with 1 selected test.

## Broader Checks

Commands:

```sh
node --test --test-name-pattern "resolved root is not a Gauge project|rejected by project root resolution|project root" test/execution/executor.test.js
node --test test/execution/executor.test.js
npm run check
```

Results:

- `node --test --test-name-pattern "resolved root is not a Gauge project|rejected by project root resolution|project root" test/execution/executor.test.js`
  passed with 7 selected tests.
- `node --test test/execution/executor.test.js` passed with 55 tests.
- `npm run check` passed: typecheck, lint, unit tests 792/792,
  LSP tests 32/32, VS Code tests 43/43, and package.

## Implementation

- Added coverage for explicit project factory rejection during active
  specification execution.
- Stopped workspace-folder fallback when an explicit project factory rejects
  project root resolution.
- Preserved fallback for tests and construction paths that do not provide an
  explicit project factory.
