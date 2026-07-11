# Test Controller Execution Ownership

## Reference behavior

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/TestRunLineMarkerProvider.java`
  registers one local run marker contributor for specification and scenario headings.
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/GaugeExecutionProducer.java`
  and `ScenarioExecutionProducer.java` keep specification and scenario run configuration
  production mutually exclusive.
- The VS Code adaptation uses `GaugeTestController` test items and Run/Debug profiles as
  the sole specification execution UI owner.

## RED

Command:

```text
node --test --test-name-pattern='leaves specification execution|removes the LSP CodeLens feature|reference code lenses without specification execution selectors' test/codeLensProvider.test.js test/gaugeWorkspace.test.js test/extension.test.js
```

Result: 3 tests failed. The local provider still returned four Run/Debug lenses, the
extension still registered specification CodeLens selectors, and the Gauge LSP CodeLens
feature remained registered after startup.

Target tests:

- `test/codeLensProvider.test.js`
- `test/extension.test.js`
- `test/gaugeWorkspace.test.js`

## GREEN

Targeted command:

```text
node --test --test-name-pattern='leaves specification execution|removes the LSP CodeLens feature|reference code lenses without specification execution selectors' test/codeLensProvider.test.js test/gaugeWorkspace.test.js test/extension.test.js
```

Result: 3 passed, 0 failed.

Related command:

```text
node --test test/codeLensProvider.test.js test/testController.test.js test/gaugeWorkspace.test.js test/extension.test.js
```

Result: 119 passed, 0 failed.

Full command:

```text
npm run check
```

Result: passed with 1,008 unit tests, 36 LSP tests, 53 VS Code tests, syntax checks,
lint checks, and VSIX packaging.
