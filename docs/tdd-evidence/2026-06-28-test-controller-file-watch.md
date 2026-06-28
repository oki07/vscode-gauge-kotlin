# Test Controller File Watch Refresh

## Scope

Parity: Gauge Test Controller refreshes workspace-discovered specs when `.spec` or `.md` files are created or deleted, and prunes stale TestItems after the Gauge LSP spec list changes.

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/SpecsExecutionProducer.java`
- `references/gauge-vscode/src/explorer/specExplorer.ts`

Target files:
- `src/testController.js`
- `test/testController.test.js`

## RED

Command:

```sh
node --test --test-name-pattern "refreshes and prunes workspace tests" test/testController.test.js
```

Result:

- Failed: 1 failed, 0 passed.
- Failure: `GaugeTestController refreshes and prunes workspace tests on spec file changes` expected a `**/*.{spec,md}` file watcher, but the Test Controller did not register one.

## GREEN

Command:

```sh
node --test --test-name-pattern "refreshes and prunes workspace tests" test/testController.test.js
```

Result:

- Passed: 1 passed, 0 failed.

## Related Check

Command:

```sh
node --test test/testController.test.js test/specExplorer.test.js test/extension.test.js test/gaugeWorkspace.test.js
```

Result:

- Passed: 55 passed, 0 failed.

## Broad Check

Command:

```sh
npm run check
```

Result:

- Passed.
- Unit tests: 596 passed, 0 failed.
- LSP tests: 22 passed, 0 failed.
- VS Code tests: 25 passed, 0 failed.
- Package step completed.
