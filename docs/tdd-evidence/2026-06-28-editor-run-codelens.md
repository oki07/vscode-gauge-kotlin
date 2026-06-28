# Editor Run CodeLens

## Behavior

Gauge specification and scenario headings must expose editor run and debug CodeLens commands.

## RED

Command:

```sh
node --test test/codeLensProvider.test.js test/extension.test.js --test-name-pattern "CodeLens|code lenses"
```

Result: failed. `src/codeLensProvider.js` was missing, and activation did not register a CodeLens provider.

## GREEN

Command:

```sh
node --test test/codeLensProvider.test.js test/extension.test.js --test-name-pattern "CodeLens|code lenses"
```

Result: passed.
