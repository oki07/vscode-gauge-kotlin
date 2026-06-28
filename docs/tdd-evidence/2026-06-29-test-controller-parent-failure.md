# Test Controller Parent Failure Status

## RED

Command:

```sh
npm run test:unit -- test/testController.test.js
```

Result: failed.

Evidence:

- `GaugeTestController does not pass a specification with a failed scenario` failed.
- A `suiteFinished` event for a spec with one failed scenario still emitted `run.passed()` for the parent spec item.

## GREEN

Command:

```sh
npm run test:unit -- test/testController.test.js
```

Result: passed, 13/13 tests.

## Broader Check

Command:

```sh
npm run check
```

Result: passed.
