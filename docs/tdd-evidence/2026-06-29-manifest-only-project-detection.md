# Manifest Only Project Detection

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/GaugeUtil.java`
- `references/gauge-vscode/src/project/projectFactory.ts`

Target behavior:
- A directory is a Gauge project when it contains `manifest.json`.
- Project detection does not require the manifest to contain `Language`.
- A valid manifest without `Language` creates a generic `GaugeProject`.

RED:
- Command: `node --test test/projectFactory.test.js`
- Result: failed, 4 passed and 3 failed.
- Failing tests:
  - `ProjectFactory detects Gauge projects by manifest`
  - `ProjectFactory finds nested Gauge project roots`
  - `ProjectFactory creates generic Gauge projects without manifest language`

GREEN:
- Command: `node --test test/projectFactory.test.js`
- Result: passed, 7 tests.

Broader checks:
- Command: `node --test test/projectFactory.test.js test/projectInitializer.test.js`
- Result: passed, 18 tests.
- Command: `npm run check`
- Result: passed, 665 unit tests, 25 LSP tests, 33 VS Code surface tests, and VSIX packaging.
- Command: `git diff --check`
- Result: passed.
- Command: `../.codex/hooks/check-source-language.sh`
- Result: passed.
