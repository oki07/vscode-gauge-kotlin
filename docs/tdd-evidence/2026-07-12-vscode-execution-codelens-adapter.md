# VS Code Execution CodeLens Adapter

## Reference behavior

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/TestRunLineMarkerProvider.java`
  uses one local marker contributor and delegates Run/Debug actions to the execution system.
- `references/gauge/api/lang/codeLens.go` displays `Run Spec`, `Debug Spec`, `Run Scenario`,
  `Debug Scenario`, and `Run in parallel` CodeLens actions with Gauge command targets.
- The adapted design keeps `GaugeTestController` and the shared execution controller as the
  execution model while one local CodeLens provider supplies the VS Code editor actions.
- Gauge LSP CodeLens registration remains disabled and cleared so it cannot duplicate the local
  adapter.

## RED

Command:

```text
node --test --test-name-pattern='one local execution surface|allows execution CodeLens|one local CodeLens provider|codeLenses.execution' test/codeLensProvider.test.js test/extension.test.js test/manifest.test.js
```

Result: 2 failed and 2 passed. The provider returned no execution actions and the extension did
not register specification selectors.

Command:

```text
node --test --test-name-pattern='core Gauge VS Code surface' test/manifest.test.js
```

Result: 1 failed because `gauge.codeLenses.execution` was missing.

Target tests:

- `test/codeLensProvider.test.js`
- `test/extension.test.js`
- `test/manifest.test.js`

## GREEN

Targeted command:

```text
node --test --test-name-pattern='one local execution surface|allows execution CodeLens|one local CodeLens provider|core Gauge VS Code surface' test/codeLensProvider.test.js test/extension.test.js test/manifest.test.js
```

Result: 4 passed, 0 failed.

Related command:

```text
node --test test/codeLensProvider.test.js test/testController.test.js test/gaugeWorkspace.test.js test/extension.test.js test/manifest.test.js
```

Result: 139 passed, 0 failed.

Full command:

```text
npm run check
```

Result: passed with 1,011 unit tests, 36 LSP tests, 53 VS Code tests, syntax checks,
lint checks, and VSIX packaging.
