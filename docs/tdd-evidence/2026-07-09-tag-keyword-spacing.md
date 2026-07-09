# Tag Keyword Spacing

## Scope

Tag completions should use the same Gauge tag keyword spacing rule as the
Gauge syntax sources. `tags:` and `tags :` are valid tag keyword lines.
`ta gs:` is not a tag keyword line.

## Source-only Reference Context

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_SpecLexer.flex`
  defines `Tags = {WhiteSpace}* tags {WhiteSpace}? ":" ...`.
- `src/semanticTokensProvider.js` already tokenizes keyword lines with
  `tags[ \t\f]?:`.
- `syntaxes/gauge.tmLanguage.json` already uses the same one-optional-space
  tag keyword rule.

## RED

Command:

```sh
node --test --test-name-pattern "requires Gauge tag keyword spacing" test/dynamicArgumentCompletion.test.js
```

Result:

- Passed: 0
- Failed: 1

Failure summary:

- `GaugeDynamicArgumentCompletionProvider requires Gauge tag keyword spacing`
  returned `smoke` for `ta gs:`.

## GREEN

Command:

```sh
node --test --test-name-pattern "requires Gauge tag keyword spacing" test/dynamicArgumentCompletion.test.js
```

Result:

- Passed: 1
- Failed: 0

Focused check:

```sh
node --test test/dynamicArgumentCompletion.test.js
```

Result:

- Passed: 60
- Failed: 0

Broader check:

```sh
npm run check
```

Result:

- Typecheck passed.
- Lint passed.
- Unit tests passed: 872
- LSP tests passed: 33
- VS Code extension tests passed: 50
- Failed: 0
- Package completed.

## Implementation Notes

- `isTagLine` now accepts at most one ` `, `\t`, or `\f` between `tags` and
  `:`.
- Tag completion no longer runs for syntactically invalid `ta gs:` lines.
