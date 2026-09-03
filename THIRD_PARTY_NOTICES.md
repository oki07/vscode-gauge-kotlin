# Third-Party Notices

## JetBrains Gauge file icons

The following files are derived from the Gauge plugin in the JetBrains
`intellij-plugins` repository:

- `images/gauge-file-light.svg`
- `images/gauge-file-dark.svg`

Source: https://github.com/JetBrains/intellij-plugins/tree/master/gauge/resources/icons

Copyright (C) 2020 ThoughtWorks, Inc.

Licensed under the Apache License, Version 2.0. A copy of the license is
available at https://www.apache.org/licenses/LICENSE-2.0.

## Gauge VS Code extension assets

The following files are copied verbatim from the official Gauge extension for
Visual Studio Code:

- `images/gauge-icon.png`
- `resources/dark/icon-list.svg`
- `resources/dark/play.svg`
- `resources/light/icon-list.svg`
- `resources/light/play.svg`

Source: https://github.com/getgauge/gauge-vscode

Copyright (c) 2017 Gauge

Licensed under the MIT License. A copy of the license is available at
https://github.com/getgauge/gauge-vscode/blob/master/LICENSE.

## Bundled npm packages

`out/extension.js` is a single esbuild bundle built with
`legalComments: "none"`, so the license headers embedded in these packages are
not present in the shipped file. They are listed here instead. Each package is
distributed under the license named below; the full text of each license is
available from the package's own repository on npm.

| Package | Version | License |
| --- | --- | --- |
| `balanced-match` | 1.0.2 | MIT |
| `brace-expansion` | 2.1.1 | MIT |
| `duplexer` | 0.1.2 | MIT |
| `event-stream` | 3.3.4 | MIT |
| `from` | 0.1.7 | MIT |
| `get-port` | 7.2.0 | MIT |
| `map-stream` | 0.1.0 | MIT |
| `minimatch` | 5.1.9 | ISC |
| `pause-stream` | 0.0.11 | MIT, Apache-2.0 |
| `pend` | 1.2.0 | MIT |
| `ps-tree` | 1.2.0 | MIT |
| `semver` | 7.8.5 | ISC |
| `split` | 0.3.3 | MIT |
| `stream-combiner` | 0.0.4 | MIT |
| `through` | 2.3.8 | MIT |
| `vscode-jsonrpc` | 8.2.0 | MIT |
| `vscode-languageclient` | 9.0.1 | MIT |
| `vscode-languageserver-protocol` | 3.17.5 | MIT |
| `vscode-languageserver-types` | 3.17.5 | MIT |
| `yauzl` | 3.4.0 | MIT |

The `map-stream` package declares no `license` field in its manifest; its
`LICENSE` file is the MIT license.
