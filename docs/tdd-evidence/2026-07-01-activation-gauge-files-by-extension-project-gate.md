# Activation Project Gate For Gauge Extension Files

## Scope

Activation must not start Gauge services for active `.spec` or `.cpt` files that are outside Gauge projects. File-extension detection is still valid inside Gauge projects, but it must share the same project-root gate used by Markdown Gauge specifications.

## References

- `references/gauge-vscode/src/project/projectFactory.ts`
- `references/gauge-vscode/src/gaugeWorkspace.ts`
- `references/gauge-vscode/src/config/gaugeProjectConfig.ts`

## RED

Command:

```sh
node --test --test-name-pattern "Gauge files by extension outside Gauge projects" test/extension.test.js
```

Result:

- Failed with 1 selected test.
- Failure: activation called `createCli` for an active `.spec` file whose resolved root was not a Gauge project.

## GREEN

Command:

```sh
node --test --test-name-pattern "Gauge files by extension outside Gauge projects" test/extension.test.js
```

Result:

- Passed with 1 selected test.

## Broader Checks

Commands:

```sh
node --test test/extension.test.js
npm run check
```

Results:

- `node --test test/extension.test.js` passed with 32 tests.
- `npm run check` passed with `test:unit` 788 tests, `test:lsp` 32 tests, `test:vscode` 43 tests, and package dry-run success.

## Implementation

- Added a shared active-file Gauge project gate.
- Kept Markdown Gauge activation behind language and extension checks before project validation.
- Required the shared project gate for active `.spec` and `.cpt` files before creating CLI, debug, or workspace services.
