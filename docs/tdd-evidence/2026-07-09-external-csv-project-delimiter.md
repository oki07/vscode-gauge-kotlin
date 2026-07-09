# External CSV Project Delimiter

## Reference

- `references/gauge/skel/skel.go`
- `references/gauge/env/env.go`

Gauge projects include `env/default/default.properties`, and Gauge loads `csv_delimiter` from environment properties for CSV parsing. The extension should use the project default delimiter for external CSV data table header completion when no process environment override is present.

## RED

Command:

```sh
node --test --test-name-pattern "project default csv delimiter|external CSV data table headers" test/dynamicArgumentCompletion.test.js
```

Result: failed with 1 passing test and 1 failing test.

Failing coverage:

- `GaugeDynamicArgumentCompletionProvider uses project default csv delimiter for external headers`

## GREEN

Command:

```sh
node --test --test-name-pattern "project default csv delimiter|external CSV data table headers" test/dynamicArgumentCompletion.test.js
```

Result: passed with 2 passing tests.

Broader targeted command:

```sh
node --test test/dynamicArgumentCompletion.test.js
```

Result: passed with 69 passing tests.

Implementation:

- External CSV header completion reads `env/default/default.properties` from the active Gauge project.
- `csv_delimiter` from the process environment remains the highest-priority delimiter source.
