# Spectacle Install In-Flight Guard

Reference:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/markdownPreview/Spectacle.java`

Behavior:
- A Spectacle install that is already running must not start another `gauge install spectacle` process.
- A repeated install action reports that installation is already in progress.

RED:
- Command: `node --test test/preview.test.js`
- Result: failed at `previewGaugeDocument does not start duplicate Spectacle installs`.
- Failure: `installGaugeRunner("spectacle")` was called twice for two concurrent preview requests.

GREEN:
- Command: `node --test test/preview.test.js`
- Result: passed 12 tests.

Implementation:
- Added a module-scope Spectacle install promise in `src/preview.js`.
- Reused the in-flight promise for repeated install actions and cleared it after success or failure.
