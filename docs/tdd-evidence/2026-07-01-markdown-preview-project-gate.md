# Markdown Preview Project Gate

## Source behavior

Gauge Markdown preview is available for Markdown specification files that belong to a Gauge project. Ordinary Markdown files must not start Spectacle generation, create preview directories, or open fallback preview output.

## RED

Command:

```sh
node --test test/preview.test.js --test-name-pattern "resolved root"
```

Result: failed. `previewGaugeDocument ignores Markdown when the resolved root is not a Gauge project` reported `Unable to create html file for example.md. should not spawn`, proving preview still reached the Gauge command path when `isGaugeProject(root)` returned `false`.

## GREEN

Command:

```sh
node --test test/preview.test.js --test-name-pattern "resolved root"
```

Result: passed. Preview now treats a resolved non-Gauge root as no active Gauge preview document and stops before CLI execution or preview directory creation.

## Broader Check

Command:

```sh
node --test test/preview.test.js
```

Result: passed. All preview tests remained green.
