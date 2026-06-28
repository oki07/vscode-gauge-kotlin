# Gauge VS Code templates

## Scope

Align the created specification document and Gauge snippets with the Gauge VS Code reference templates.

Reference sources:

- `references/gauge-vscode/src/file/specificationFileProvider.ts`
- `references/gauge-vscode/snippets/gauge.json`

Target source:

- `src/specification.js`
- `snippets/gauge.json`
- `test/specification.test.js`
- `test/manifest.test.js`

## RED

Commands:

```sh
node --test --test-name-pattern "buildSpecificationDocument|Gauge snippets" test/specification.test.js test/manifest.test.js
node --test --test-name-pattern "core Gauge VS Code surface" test/manifest.test.js
```

Result: failed as expected.

Observed failures:

- `buildSpecificationDocument` still produced the legacy underline heading template.
- Gauge snippets still produced the legacy underline heading and verbose concept bodies.

## GREEN

Command:

```sh
node --test --test-name-pattern "buildSpecificationDocument|core Gauge VS Code surface" test/specification.test.js test/manifest.test.js
```

Result: passed, 3/3 tests.

Related command:

```sh
node --test test/specification.test.js test/manifest.test.js test/extension.test.js
```

Result: passed, 36/36 tests.

## Broader checks

Command:

```sh
npm run check
```

Result: passed. Unit tests passed 606/606, LSP tests passed 22/22, VS Code tests passed 26/26, and package creation succeeded.
