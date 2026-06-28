# Test Controller Gauge Notifications

## RED

- Command: `node --test test/testController.test.js --test-name-pattern "notification events"`
- Result: failed as expected.
- Failing test: `test/testController.test.js`
- Failure: Gauge notification events produced no VS Code message calls.

## GREEN

- Command: `node --test test/testController.test.js --test-name-pattern "notification events"`
- Result: passed 6/6.

## Broader Checks

- Command: `node --test test/testController.test.js test/execution/lineProcessors.test.js test/execution/executor.test.js test/extension.test.js`
- Result: passed 63/63.
- Command: `npm run check`
- Result: passed.
