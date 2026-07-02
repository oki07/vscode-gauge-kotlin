# Explorer Multi-Select Project Split

## Scope

Explorer multi-select execution must not resolve every selected specification
against only the first selected target's Gauge project. Selected runnable
targets are grouped by Gauge project root and executed once per project.

## References

- `references/gauge-vscode/src/execution/gaugeExecutor.ts`
- `vscode-gauge-kotlin/src/testController.js`

## RED

Command:

```sh
node --test --test-name-pattern "splits Explorer selected specs by project root" test/execution/executor.test.js
```

Result:

- Failed with 1 selected test.
- Failure: a checkout project spec and an accounts project spec were both
  executed in the checkout project, producing one Gauge command instead of one
  command per project root.

## GREEN

Command:

```sh
node --test --test-name-pattern "splits Explorer selected specs by project root" test/execution/executor.test.js
```

Result:

- Passed with 1 selected test.

## Broader Checks

Commands:

```sh
node --test --test-name-pattern "Explorer selected spec files and directories|project root" test/execution/executor.test.js
node --test test/execution/executor.test.js
npm run check
```

Results:

- `node --test --test-name-pattern "Explorer selected spec files and directories|project root" test/execution/executor.test.js`
  passed with 6 selected tests.
- `node --test test/execution/executor.test.js` passed with 54 tests.
- `npm run check` passed: typecheck, lint, unit tests 791/791,
  LSP tests 32/32, VS Code tests 43/43, and package.

## Implementation

- Added grouping for selected Explorer execution targets by resolved Gauge
  project root.
- Kept the existing single-project execution path for one project group.
- Kept project-root directory selection running all specs for that project.
