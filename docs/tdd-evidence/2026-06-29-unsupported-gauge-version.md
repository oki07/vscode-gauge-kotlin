# Unsupported Gauge Version Notification

Reference source:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/GaugeComponent.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/module/GaugeModuleBuilder.java`

Target behavior:
- When Gauge is installed but older than the minimum supported version, activation shows unsupported-version guidance instead of install guidance.
- Gauge workspace services do not start when the installed Gauge version is unsupported.

RED:
- Command: `node --test test/extension.test.js test/welcomeNotifications.test.js --test-name-pattern "unsupported Gauge version|install guidance|showUnsupported"`
- Result: failed, 25 passed and 2 failed.
- Failing tests:
  - `activation shows unsupported Gauge version guidance when Gauge is too old`
  - `showUnsupportedGaugeVersionNotification reports the minimum Gauge version`

GREEN:
- Command: `node --test test/extension.test.js test/welcomeNotifications.test.js --test-name-pattern "unsupported Gauge version|install guidance|showUnsupported"`
- Result: passed, 27 tests.

Broader checks:
- Command: `npm run check`
- Result: passed, 662 unit tests, 25 LSP tests, 33 VS Code surface tests, and VSIX packaging.
- Command: `git diff --check`
- Result: passed.
- Command: `../.codex/hooks/check-source-language.sh`
- Result: passed.
