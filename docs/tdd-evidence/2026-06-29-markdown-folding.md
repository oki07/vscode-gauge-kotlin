# Markdown Gauge Spec Folding

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/language/SpecFileTypeFactory.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/folding/SpecFoldingBuilder.java`

Target behavior:
- Register Gauge folding for Markdown `.md` documents so Markdown language mode Gauge specs receive the same folding ranges as `.spec` files.
- Ignore ordinary Markdown files outside Gauge projects.

RED:
- Command: `node --test test/foldingRangeProvider.test.js test/extension.test.js`
- Result: failed before implementation.
- Failing tests:
  - `activation starts Gauge workspace services for Gauge projects`
  - `GaugeFoldingRangeProvider ignores markdown outside Gauge projects`

GREEN:
- Command: `node --test test/foldingRangeProvider.test.js test/extension.test.js`
- Result: passed, 32 tests.

Broader checks:
- Command: `npm run check`
- Result: passed.
- Command: `git diff --check`
- Result: passed.
- Command: `../.codex/hooks/check-source-language.sh`
- Result: passed.
