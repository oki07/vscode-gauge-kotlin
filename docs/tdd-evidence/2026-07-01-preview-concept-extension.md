# Preview Concept Files By Extension

## Reference behavior

- Reference path: `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/markdownPreview/GaugeWebBrowserPreview.java`
- Local path: `src/preview.js`

IntelliJ preview handles both Gauge specification and concept file types. The
VS Code command already previews Gauge language documents and Markdown Gauge
specs, but a `.cpt` concept opened with a non-Gauge language id was rejected
before project resolution.

## RED

Command:

```text
node --test --test-name-pattern "concept files by extension" test/preview.test.js
```

Result: failed. The command reported `Open a Gauge specification or concept to
preview.` instead of running `gauge docs spectacle` for the `.cpt` file.

## GREEN

Command:

```text
node --test --test-name-pattern "concept files by extension" test/preview.test.js
```

Result: passed with 1 selected test after recognizing `.spec` and `.cpt` files
by extension.

## Broader checks

Command:

```text
node --test test/preview.test.js
```

Result: passed with 9 tests.

Command:

```text
node --test test/preview.test.js test/extension.test.js test/manifest.test.js
```

Result: passed with 49 tests.
