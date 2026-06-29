# Spec Template VS Code Parity

## Reference Source

- `references/gauge-vscode/src/file/specificationFileProvider.ts`
- `references/gauge-vscode/snippets/gauge.json`

## RED

- Command: `node --test test/specification.test.js --test-name-pattern "buildSpecificationDocument|createSpecification writes|createSpecification asks"`
- Result: failed, 6 passed and 4 failed.
- Failing tests:
  - `buildSpecificationDocument matches the Gauge help template`
  - `buildSpecificationDocument can omit help comments`
  - `createSpecification writes a spec file under the workspace specs directory`
  - `createSpecification asks for project and spec directory when multiple choices exist`
- Failure reason: generated specifications still included the `Created by ... on ...` line that gauge-vscode does not emit.

## GREEN

- Command: `node --test test/specification.test.js --test-name-pattern "buildSpecificationDocument|createSpecification writes|createSpecification asks"`
- Result: passed, 10 tests.

## Broader Checks

- Command: `npm run check`
- Result: passed, 673 unit tests, 25 LSP tests, 34 VS Code surface tests, and VSIX packaging.

## Change

- New specification generation now matches gauge-vscode by omitting the creator/date line.
- The default editor selection moved to the generated `* step` line after removing that line.
