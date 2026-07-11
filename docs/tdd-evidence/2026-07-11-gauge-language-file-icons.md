# Gauge language file icons

## Scope

Show the Gauge logo for `.spec` and `.cpt` files in the Explorer without
requiring users to replace their active file icon theme.

## Reference behavior

The IntelliJ Gauge plugin assigns its Gauge file icon to both specification and
concept file types. VS Code supports the equivalent fallback through the
`icon` property of a language contribution.

## RED

Command:

```sh
node --test --test-name-pattern "extension manifest exposes the core Gauge VS Code surface for Kotlin projects" test/manifest.test.js
```

Result: failed with 0 passing and 1 failing test because the `gauge` language
had no contributed icon.

## GREEN

Commands:

```sh
node --test --test-name-pattern "extension manifest exposes the core Gauge VS Code surface for Kotlin projects" test/manifest.test.js
node --test test/manifest.test.js
```

Result: passed with 1 selected manifest test and all 15 manifest tests.

Broader command:

```sh
npm run check
```

Result: passed with 1,004 unit tests, 33 LSP tests, 53 VS Code surface tests,
syntax and lint checks, and a successful VSIX package dry run.

## Implementation

- Assign the packaged Gauge logo to both light and dark variants of the `gauge`
  language icon.
- Assign the same logo to the `gauge-concept` language icon.
- Keep the complete Gauge file icon theme as an optional fallback for active
  icon themes that explicitly override language icons.
