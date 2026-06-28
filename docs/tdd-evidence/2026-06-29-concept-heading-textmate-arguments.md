# Concept Heading TextMate Arguments

Reference source:
- `references/intellij-gauge-plugin/src/concept.bnf`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/lexer/_ConceptLexer.java`

Target behavior:
- Hash concept headings keep dynamic and static argument scopes reachable in the TextMate grammar.
- The first top-level hash heading pattern must not consume the entire line before `#arguments` can run.

RED:
- Command: `node --test test/manifest.test.js --test-name-pattern "TextMate grammar"`
- Result: failed before implementation.
- Failing test:
  - `Gauge TextMate grammar keeps arguments reachable in hash concept headings`
- Verification against previous grammar: `git show HEAD:syntaxes/gauge.tmLanguage.json` matched `#specHeading` with no nested patterns for `# Shared checkout <item> "card"`.

GREEN:
- Command: `node --test test/manifest.test.js --test-name-pattern "TextMate grammar"`
- Result: passed, 10 tests.

Broader checks:
- Command: `npm run check`
- Result: passed, 653 unit tests, 25 LSP tests, 31 VS Code surface tests, and VSIX packaging.
- Command: `git diff --check`
- Result: passed.
- Command: `../.codex/hooks/check-source-language.sh`
- Result: passed.
