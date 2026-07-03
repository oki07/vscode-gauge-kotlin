# Indented Step TextMate Grammar

## Scope

- Tokenize Gauge step lines whose first non-whitespace character is `*` in the TextMate grammar.
- Keep the step marker capture on the `*` character, not on the indentation.

## RED

Command:

```sh
node --test --test-name-pattern "Gauge TextMate grammar follows Gauge lexer line starts and keywords" test/manifest.test.js
```

Result:

- pass 0
- fail 1

The grammar step pattern `^(\\*)(\\s*)` did not match `  * do something`.

## GREEN

Command:

```sh
node --test --test-name-pattern "Gauge TextMate grammar follows Gauge lexer line starts and keywords" test/manifest.test.js
```

Result:

- pass 1
- fail 0

Focused command:

```sh
node --test test/manifest.test.js
```

Result:

- pass 12
- fail 0

Broad command:

```sh
npm run check
```

Result:

- typecheck passed
- lint passed
- test:unit pass 841, fail 0
- test:lsp pass 32, fail 0
- test:vscode pass 46, fail 0
- package passed
