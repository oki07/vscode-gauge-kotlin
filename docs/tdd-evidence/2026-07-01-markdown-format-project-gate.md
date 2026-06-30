# Markdown Format Project Gate

## Source behavior

Gauge Markdown files are accepted as Gauge specification documents only inside Gauge projects. Formatter actions must not run Gauge commands for ordinary Markdown files when root discovery returns a directory that is not a Gauge project.

## RED

Command:

```sh
node --test test/formatProvider.test.js --test-name-pattern "resolved root"
```

Result: failed. `GaugeFormatProvider ignores Markdown when the resolved root is not a Gauge project` reported `Error on formatting spec. should not spawn`, proving the formatter still spawned the Gauge CLI when `isGaugeProject(root)` returned `false`.

## GREEN

Command:

```sh
node --test test/formatProvider.test.js --test-name-pattern "resolved root"
```

Result: passed. The provider now checks the resolved root with `projectFactory.isGaugeProject(root)` when available and returns no edits for Markdown files outside Gauge projects.

## Broader Check

Command:

```sh
node --test test/formatProvider.test.js
```

Result: passed. All format provider tests remained green.
