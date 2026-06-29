# Kotlin Dollar Step Literals

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/annotator/CreateStepImplFix.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/rename/CustomRenameHandler.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/StepUtil.java`

## RED

- Command: `node --test test/stepCodeActions.test.js --test-name-pattern "escapes Kotlin string templates"`
- Result: failed.
- Failure: generated Kotlin step stubs used `@Step("Pay $amount")`, which lets Kotlin treat `$amount` as a string template.
- Command: `node --test test/renameProvider.test.js --test-name-pattern "escapes Kotlin string templates"`
- Result: failed.
- Failure: Kotlin Step annotation rename replacement used `Pay $amount` instead of `Pay \\$amount`.

## GREEN

- Command: `node --test test/stepCodeActions.test.js --test-name-pattern "escapes Kotlin string templates"`
- Result: passed, 5 tests.
- Command: `node --test test/renameProvider.test.js --test-name-pattern "escapes Kotlin string templates"`
- Result: passed, 13 tests.
- Command: `node --test test/stepCodeActions.test.js`
- Result: passed, 5 tests.
- Command: `node --test test/renameProvider.test.js`
- Result: passed, 14 tests.

## Broader Check

- Command: `git diff --check`
- Result: passed.
- Command: `npm run check`
- Result: passed, including 691 unit tests, 26 LSP tests, 36 VS Code and manifest tests, and packaging.

## Change

- Escaped `$` when generating regular Kotlin Step annotation string literals.
- Escaped `$` when renaming Kotlin Step annotation literals.
- Kept Java Step annotation rename text unescaped.
