# IntelliJ Gauge file icon parity

## Scope

Replace the oversized marketplace logo used for `.spec` and `.cpt` Explorer
icons with the current 16 by 16 IntelliJ Gauge file icon assets.

## Reference behavior

The current JetBrains Gauge plugin exposes `gauge.svg` and `gauge_dark.svg` as
16 by 16 transparent file icons. Both specification and concept file types use
the same `GaugeIcons.Gauge` icon.

## RED

Command:

```sh
node --test --test-name-pattern "extension manifest exposes the core Gauge VS Code surface for Kotlin projects" test/manifest.test.js
```

Result: failed with 0 passing and 1 failing test because both language
contributions still referenced the 120 by 120 marketplace PNG.

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
syntax and lint checks, and a successful VSIX package dry run. The packaged
VSIX contains both SVG assets and `THIRD_PARTY_NOTICES.md`.

## Implementation

- Package the current IntelliJ Gauge light and dark 16 by 16 SVG assets.
- Use the theme-appropriate SVG for both Gauge language contributions.
- Update the optional Gauge file icon theme with light-theme associations.
- Package third-party source and license attribution.
