# Specification Created-By Template

Reference:
- `references/intellij-gauge-plugin/resources/fileTemplates/Specification.spec.ft`
- `references/intellij-gauge-plugin/resources/fileTemplates/Concept.cpt.ft`
- `references/gauge-vscode/src/file/specificationFileProvider.ts`

Parity behavior:
- New specification files include the created-by line from the IntelliJ Gauge specification template.
- The VS Code adaptation keeps the current Markdown heading style while using the existing `user` and `date` inputs already passed to `buildSpecificationDocument()`.

RED:
- Command: `node --test test/specification.test.js`
- Result: failed 2 tests because `buildSpecificationDocument()` omitted `Created by Ada on 2026-06-26`.

GREEN:
- Command: `node --test test/specification.test.js`
- Result: passed, 10 tests.
