# Source parity batch 1

## Scope

Implement source-comparison parity items that are fully possible in a VS Code extension:

- Pass configured `GAUGE_HOME` to the Gauge version and plugin discovery probe.
- Add format and extract keybindings, plus Explorer folder commands for spec and concept creation.
- Use Explorer folder URIs as the spec or concept creation target directory.
- Align the generated specification file and snippets with the IntelliJ Gauge file templates.
- Fall back to the system Gradle command for wrapper-less Gradle projects.
- Suggest concept dynamic arguments from table body cells.
- Scope Gauge run CodeLens entries to files that belong to Gauge projects.

## RED

Commands:

```sh
node --test test/cli.test.js
node --test test/manifest.test.js
node --test test/extension.test.js
node --test test/specification.test.js
node --test test/project.test.js
node --test test/dynamicArgumentCompletion.test.js
node --test test/codeLensProvider.test.js
```

Result: failed as expected.

Failing expectations:

- `CLI.instance` did not pass `GAUGE_HOME` to `gauge --version --machine-readable`.
- Manifest keybindings and Explorer context menu entries were missing.
- File creation commands ignored the Explorer folder URI.
- Specification generation and snippets still used the previous hash-heading template.
- `GradleProject` returned `./gradlew` even when no wrapper existed.
- Concept table body dynamic arguments were not suggested.
- CodeLens entries were still shown for files outside Gauge projects, and activation did not pass `projectFactory` to the CodeLens provider.

## GREEN

Commands:

```sh
node --test test/cli.test.js
node --test test/manifest.test.js
node --test test/extension.test.js
node --test test/specification.test.js
node --test test/project.test.js
node --test test/execution/executor.test.js
node --test test/dynamicArgumentCompletion.test.js
node --test test/codeLensProvider.test.js
```

Result: passed.

Combined command:

```sh
node --test test/cli.test.js test/manifest.test.js test/extension.test.js test/specification.test.js test/project.test.js test/execution/executor.test.js test/dynamicArgumentCompletion.test.js test/codeLensProvider.test.js
```

Result: passed, 130/130 tests.

## Broader checks

Command:

```sh
npm run check
```

Result: passed. Unit tests passed 569/569, LSP tests passed 20/20, VS Code tests passed 24/24, and package creation succeeded.
