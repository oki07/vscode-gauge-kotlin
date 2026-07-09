# Step References Request Parameters

## Reference

- `references/gauge/api/lang/references.go` unmarshals `gauge/stepReferences` parameters as `[]string`.
- `references/gauge/api/lang/references_test.go` sends `[]string{"Say {} to {}"}`.

## RED

Command:

```sh
node --test test/gaugeReference.test.js
```

Result: failed with 11 tests because valid `gauge/stepReferences` requests still sent the step value as a bare string.

## GREEN

Command:

```sh
node --test test/gaugeReference.test.js
```

Result: passed with 29 tests.
