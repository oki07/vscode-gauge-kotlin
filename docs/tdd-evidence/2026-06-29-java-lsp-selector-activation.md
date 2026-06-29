# Java LSP Selector Activation

## Reference Source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/GaugeModuleComponent.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/module/lib/GaugeLibHelper.java`
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/module/lib/LibHelperFactory.java`

## RED

- `node --test test/gaugeWorkspace.test.js --test-name-pattern "mixed-case Java plugins"` failed because Java Gauge projects only selected Gauge documents.
- `node --test test/manifest.test.js --test-name-pattern "core Gauge VS Code surface"` failed because `onLanguage:java` was missing.
- `node --test test/extension.test.js --test-name-pattern "active Java implementation document"` failed because active Java implementation documents did not start Gauge services.

## GREEN

- `node --test test/gaugeWorkspace.test.js --test-name-pattern "mixed-case Java plugins"` passed.
- `node --test test/manifest.test.js --test-name-pattern "core Gauge VS Code surface"` passed.
- `node --test test/extension.test.js --test-name-pattern "active Java implementation document"` passed.

## Change

- Java Gauge projects add Java language and `**/*.java` document selectors to the Gauge LSP client options.
- Active Java implementation documents can trigger Gauge service startup like Kotlin implementation documents.
- The extension manifest activates on Java language documents.
