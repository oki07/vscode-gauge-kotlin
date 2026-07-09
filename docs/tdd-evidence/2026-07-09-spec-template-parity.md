# Specification Template Parity

## Scope

- Reference source: `references/gauge-vscode/src/file/specificationFileProvider.ts`
- Target source: `src/specification.js`
- Test source: `test/specification.test.js`

## RED

Command:

```sh
node --test test/specification.test.js
```

Result:

- Failed 4 tests.
- `buildSpecificationDocument matches the Gauge help template`
- `buildSpecificationDocument can omit help comments`
- `createSpecification writes a spec file under the workspace specs directory`
- `createSpecification asks for project and spec directory when multiple choices exist`

Reason:

- The target spec template added a `Created by ...` line that is not present in the Gauge VS Code reference template.

## GREEN

Command:

```sh
node --test test/specification.test.js
```

Result:

- Passed 10 tests.

Implementation:

- Removed the generated `Created by ...` line from new specification files.
- Updated the default cursor selection to match the reference template line positions.
