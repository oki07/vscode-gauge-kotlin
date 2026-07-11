# Gauge language auto-closing pairs

## Scope

Prevent Gauge specification editors from failing while Cursor or VS Code creates
the editor model from the registered language configuration.

## Runtime evidence

Cursor 3.11.13 renderer logs reported `Cannot read properties of undefined
(reading 'charAt')` from `getAutoClosingPairs`. The bundled editor code iterates
auto-closing pair entries through `pair.open.charAt(...)`, while the extension
registered character-pair arrays without `open` and `close` properties.

## RED

Command:

```sh
node --test --test-name-pattern "activation preserves Gauge editor language configuration" test/extension.test.js
```

Result: failed with 0 passing and 1 failing test. The activation path returned
`[["<", ">"], ["\"", "\""]]` instead of auto-closing pair objects.

## GREEN

Commands:

```sh
node --test --test-name-pattern "activation preserves Gauge editor language configuration" test/extension.test.js
node --test test/manifest.test.js
```

Result: passed with 1 selected activation test and all 15 manifest tests.

Broader command:

```sh
npm run check
```

Result: passed with 1,002 unit tests, 33 LSP tests, 53 VS Code surface tests,
syntax and lint checks, and a successful VSIX package dry run. The first broad
run exposed an existing execution test that discovered the locally installed
Gauge executable; that test now injects an unavailable CLI explicitly and the
isolated rerun passed with 1 selected test.

## Implementation

- Register runtime auto-closing pairs as objects with `open` and `close` fields.
- Package the same object representation in `language-configuration.json`.
- Preserve character-pair arrays for brackets and surrounding pairs.
