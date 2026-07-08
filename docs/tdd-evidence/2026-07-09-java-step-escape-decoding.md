# Java Step Escape Decoding

Reference:
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/StepUtil.java`

Parity behavior:
- Java `@Step` annotation string constants must be evaluated like Java string constants.
- Unicode escapes such as `\u0077` and octal escapes such as `\167` must match Gauge steps after decoding.

RED:
- Command: `node --test --test-name-pattern "decodes Java unicode and octal escapes" test/stepDiagnostics.test.js`
- Result: failed because both Gauge spec steps were reported as `Undefined Step`.

GREEN:
- Command: `node --test --test-name-pattern "decodes Java unicode and octal escapes" test/stepDiagnostics.test.js`
- Result: passed after Java string literal parsing decoded Unicode and octal escapes.

Focused:
- Command: `node --test test/stepDiagnostics.test.js`
- Result: passed, 217 tests.
