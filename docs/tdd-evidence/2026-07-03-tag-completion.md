# Tag Completion

## Reference Source

- `references/gauge/api/lang/capabilities.go`
- `references/gauge/api/lang/completion.go`
- `references/gauge/api/lang/completionTags.go`
- `references/gauge/api/lang/completionTags_test.go`
- `references/gauge-lsp-tests/specifications/codecompletion/tags.spec`

## RED

- Command: `node --test --test-name-pattern 'Gauge tags|dynamic argument completions' test/dynamicArgumentCompletion.test.js test/extension.test.js`
- Result: failed, 0 passed and 3 failed.
- Failure: tag lines returned no completion items.
- Failure: tag continuation lines returned no completion items.
- Failure: completion trigger characters omitted `:` and `,`.

## GREEN

- Command: `node --test --test-name-pattern 'Gauge tags|dynamic argument completions' test/dynamicArgumentCompletion.test.js test/extension.test.js`
- Result: passed, 3 tests.
- Command: `node --test test/dynamicArgumentCompletion.test.js test/extension.test.js`
- Result: passed, 82 tests.

## Broader Check

- Command: `npm run check`
- Result: passed, including 816 unit tests, 32 LSP tests, 46 VS Code and manifest tests, and packaging.

## Change

- Added local Gauge tag completion on `tags:` lines.
- Added tag completion on comma-continued tag lines.
- Preserved Gauge LSP text-edit behavior when completing a tag in the middle of a tag list.
- Added `:` and `,` completion trigger characters.
