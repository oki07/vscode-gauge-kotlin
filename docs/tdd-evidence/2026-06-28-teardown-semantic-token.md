# Teardown semantic token

## Scope

Tokenize Gauge teardown separator lines as a dedicated semantic token instead of a generic comment token.

Reference source:

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_SpecLexer.flex`

Target source:

- `src/semanticTokensProvider.js`
- `test/semanticTokensProvider.test.js`

## RED

Command:

```sh
node --test --test-name-pattern "teardown separators" test/semanticTokensProvider.test.js
```

Result: failed as expected, 0/1 tests passed.

Observed failure:

- The semantic token legend did not contain `teardownIdentifier`.

## GREEN

Command:

```sh
node --test --test-name-pattern "teardown separators" test/semanticTokensProvider.test.js
```

Result: passed, 1/1 tests.

Related command:

```sh
node --test test/semanticTokensProvider.test.js test/foldingProvider.test.js test/dynamicArgumentCompletion.test.js
```

Result: passed, 60/60 tests.

## Broader checks

Command:

```sh
npm run check
```

Result: passed. Unit tests passed 606/606, LSP tests passed 22/22, VS Code tests passed 26/26, and package creation succeeded.
