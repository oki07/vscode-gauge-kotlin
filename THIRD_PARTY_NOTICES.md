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
- `test/fixtures/gauge-vscode-manifest.json`

`test/fixtures/gauge-vscode-assets.json` records the SHA-256 digests of that
extension's own asset tree. Neither fixture is shipped: `.vscodeignore` keeps
`test/` out of the package.

Source: https://github.com/getgauge/gauge-vscode

Copyright (c) 2017 Gauge

Licensed under the MIT License. A copy of the license is available at
https://github.com/getgauge/gauge-vscode/blob/master/LICENSE.

## Gauge VS Code Markdown grammar

The Markdown fence and continuation rules in `syntaxes/gauge.tmLanguage.json`
and `syntaxes/gauge-concept.tmLanguage.json`, and the block/inline rules in
`syntaxes/gauge-quoted-markdown.tmLanguage.json`, are adapted from the official
Gauge VS Code extension's `syntaxes/markdown.tmLanguage`.
`test/fixtures/textmate-fence-context.json` and
`test/fixtures/textmate-quote-context.json` and
`test/fixtures/textmate-html-context.json` record observed container and fence
decisions from execution of that grammar; tests and fixtures are excluded from the VSIX.

Source: https://github.com/getgauge/gauge-vscode/blob/master/syntaxes/markdown.tmLanguage

MIT License

Copyright (c) 2017 Gauge

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Bundled npm packages

`out/extension.js` is a single esbuild bundle built with
`legalComments: "none"`, so the license headers embedded in these packages are
not present in the shipped file. They are listed here instead. Each package is
distributed under the license named below; the full text of each license is
available from the package's own repository on npm.

| Package | Version | License |
| --- | --- | --- |
| `balanced-match` | 1.0.2 | MIT |
| `brace-expansion` | 2.1.4 | MIT |
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
