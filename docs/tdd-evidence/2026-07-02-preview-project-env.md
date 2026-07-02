# Preview Project Environment

## Scope

Gauge preview must pass the active Gauge project's environment into the `gauge docs spectacle` process. Kotlin/JVM projects may rely on project classpath environment values, and preview should preserve those values the same way formatting and execution do.

## References

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/markdownPreview/GaugeWebBrowserPreview.java`
- `vscode-gauge-kotlin/src/formatProvider.js`

## RED

Command:

```sh
node --test --test-name-pattern "project environment" test/preview.test.js
```

Result:

- Failed with 1 selected test.
- Failure: Spectacle spawn environment contained `PATH` and `spectacle_out_dir`, but did not include the project `gauge_custom_classpath`.

## GREEN

Command:

```sh
node --test --test-name-pattern "project environment" test/preview.test.js
```

Result:

- Passed with 1 selected test.

## Broader Checks

Command:

```sh
node --test test/preview.test.js
npm run check
```

Result:

- Passed with 10 tests.
- `npm run check` passed with `test:unit` 790 tests, `test:lsp` 32 tests, `test:vscode` 43 tests, and package dry-run success.

## Implementation

- Resolved the active preview file to its Gauge project object when available.
- Merged `project.envs(cli)` into the Spectacle spawn environment.
- Preserved existing fallback behavior when only a project root is available.
