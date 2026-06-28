# Gauge Format Provider

## Behavior

Gauge documents must support VS Code document formatting by running `gauge format` and returning formatted document edits.

## RED

Command:

```sh
node --test test/formatProvider.test.js test/extension.test.js --test-name-pattern "GaugeFormatProvider|document formatting"
```

Result: failed. `src/formatProvider.js` was missing, and activation did not register a document formatting provider.

## GREEN

Command:

```sh
node --test test/formatProvider.test.js test/extension.test.js --test-name-pattern "GaugeFormatProvider|document formatting"
```

Result: passed.
