# Test Controller Discovery and Include Execution

## RED

Command:

```sh
node --test test/testController.test.js --test-name-pattern "discovers specification|runs included"
```

Result: failed.

Evidence:

- The discovery test failed because the specification TestItem was not created from the open Gauge document.
- The include execution test failed because `GaugeTestController.run()` always called `gauge.execute.specification.all` instead of running the included TestItems.

## GREEN

Command:

```sh
node --test test/testController.test.js
```

Result: passed, 4/4 tests.

## Broader Check

Command:

```sh
node --test test/testController.test.js test/extension.test.js test/codeLensProvider.test.js test/specExplorer.test.js
```

Result: passed, 30/30 tests.

Command:

```sh
npm run check
```

Result: passed.
