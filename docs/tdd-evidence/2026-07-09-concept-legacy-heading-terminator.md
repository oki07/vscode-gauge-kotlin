# Concept Legacy Heading Terminator

## Scope

Legacy underline concept headings should follow the IntelliJ Gauge lexer rule.
A concept heading written as `Title` followed by `====` is only a heading when
the underline line is terminated.

## Source-only Reference Context

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_ConceptLexer.flex`
  defines legacy concept headings as
  `{InputCharacterWithoutIdentifiers}+ {LineTerminator}[=]+ {LineTerminator}`.
- `src/semanticTokensProvider.js` already enforces this terminator requirement
  for semantic tokenization.

## RED

Command:

```sh
node --test --test-name-pattern "findConceptHeadings ignores unterminated legacy underline concept headings" test/stepDiagnostics.test.js
```

Result:

- Passed: 0
- Failed: 1

Failure summary:

- `findConceptHeadings` returned `Shared login` for a two-line EOF block
  without a line terminator after the underline.

## GREEN

Command:

```sh
node --test --test-name-pattern "findConceptHeadings ignores unterminated legacy underline concept headings" test/stepDiagnostics.test.js
```

Result:

- Passed: 1
- Failed: 0

Focused checks:

```sh
node --test test/stepDiagnostics.test.js
node --test test/semanticTokensProvider.test.js
```

Result:

- Step diagnostics tests passed: 218
- Semantic token tests passed: 33
- Failed: 0

Broader check:

```sh
npm run check
```

Result:

- Typecheck passed.
- Lint passed.
- Unit tests passed: 873
- LSP tests passed: 33
- VS Code extension tests passed: 50
- Failed: 0
- Package completed.

## Implementation Notes

- `conceptLegacyHeading` now requires one array entry after the underline line,
  which represents the line terminator required by the reference lexer.
- Hash-style concept headings are unchanged and may still appear at EOF.
