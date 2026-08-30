# Gauge Kotlin

Visual Studio Code support for [Gauge](https://gauge.org) specifications backed
by Kotlin step implementations.

A Gauge Kotlin project runs on the `gauge-java` runner, so its `manifest.json`
declares `"Language": "java"` while the step implementations live in Kotlin. The
`gauge-java` runner only parses `.java` sources, so this extension does the
Kotlin analysis itself: diagnostics, navigation, references, rename and
completion are computed in the extension from the workspace's Kotlin sources,
while Gauge's own language server keeps ownership of the specification files.

## Requirements

- Visual Studio Code 1.82 or newer.
- Gauge CLI 0.9.6 or newer, on `PATH` or configured through `gauge.executablePath`.
- A Gauge project using Kotlin step implementations, built with Gradle or Maven.

Kotlin source intelligence outside Gauge step integration is expected to come
from a Kotlin language extension such as Kotlin by JetBrains.

## Getting started

Run **Gauge: Create a new Gauge Project** (`gauge.createProject`) and pick
`kotlin_gradle` or `kotlin_maven`. Gauge itself publishes no Kotlin template, so
both are bundled with this extension; any Kotlin template you register with
`gauge template <name> <url>` is offered alongside them and wins on name.
`gauge.kotlin.template` chooses which build tool is offered first.

## Features

### Specifications and concepts

- Syntax highlighting, semantic tokens, folding, document and workspace symbols
  for `.spec`, `.cpt` and Markdown specifications inside the project's
  `gauge_specs_dir`.
- Diagnostics for undefined steps, parameter count mismatches, malformed tables,
  duplicate concepts, unresolved dynamic parameters and Gauge's own parse errors.
- Completion for steps, concepts, dynamic arguments and table columns.
- **Gauge: Format Gauge File** (`gauge.format`, `ctrl+alt+shift+l`) and
  **Gauge: Toggle Gauge Line Comment** (`gauge.toggle.lineComment`, `ctrl+/`).
- **Gauge: Preview Gauge File** (`gauge.preview`) renders the specification.
- **Gauge: Extract to Concept** (`gauge.extract.concept`, `ctrl+alt+c`).
- **Gauge: Create New Specification** (`gauge.create.specification`) and
  **Gauge: Create New Concept** (`gauge.create.concept`), also available from a
  folder's context menu in the Explorer.

### Kotlin step implementations

- Go to Definition from a specification step to its Kotlin `@Step` function, and
  Find All References the other way, including unopened workspace files.
- Rename a step from either side: renaming the specification text rewrites the
  Kotlin annotation, and renaming the annotation rewrites every usage.
- Quick fix to create a missing step implementation, writing Kotlin directly
  rather than delegating to the Java runner.
- Parameter count and argument type diagnostics on `@Step` annotations,
  including aliases, `typealias` chains, `const val` step text and multi-line
  arguments.
- Unreferenced `@Step` functions and unreferenced concepts are faded.
- **Gauge: Show all references at cursor** (`gauge.showReferences.atCursor`).

### Running specifications

- Native **Test Explorer** integration: the whole project tree, run and debug
  profiles, per-scenario results, failure locations and Gauge's own output.
- A **Gauge Specs** view listing the specifications and scenarios of the active
  project, with per-node run and debug actions
  (`gauge.specexplorer.runNode`, `gauge.specexplorer.debugNode`,
  `gauge.specexplorer.runAllActiveProjectSpecs`,
  `gauge.specexplorer.switchProject`).
- Run and Debug code lenses above every specification and scenario.
- Commands for the usual Gauge run modes:
  `gauge.execute.specification`, `gauge.execute.specification.all`,
  `gauge.execute.scenario`, `gauge.execute.scenarios`,
  `gauge.execute.failed`, `gauge.execute.repeat`, `gauge.stopExecution`, and
  `gauge.report.html` to open the last HTML report.
- Debugging attaches to the JVM the runner starts; the port is
  `gauge.execution.debugPort`. A Kotlin or Java debug extension must be
  installed for the attach to succeed.
- Test Explorer selections use one Gauge process for the plain CLI. Gradle and
  Maven projects run each selected target separately because their build-plugin
  target property accepts one specification at a time.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `gauge.executablePath` | `""` | Path to the `gauge` executable. Empty uses `PATH`. |
| `gauge.home` | `""` | Path to `GAUGE_HOME`. Empty uses the process environment or the Gauge default. |
| `gauge.welcomeNotification.showOn` | `newProjectLoad` | When the welcome page is shown. |
| `gauge.specExplorer.enabled` | `true` | Show the Gauge Specs tree view. Turning it off leaves every other Gauge command in place. |
| `gauge.launch.enableDebugLogs` | `false` | Log the traffic between VS Code and the Gauge language server. |
| `gauge.execution.debugPort` | `9229` | Debug port for the runner JVM. |
| `gauge.create.specification.withHelp` | `true` | Create new specifications with help comments. |
| `gauge.codeLenses.reference` | `true` | Show reference code lenses on implementation files. |
| `gauge.codeLenses.execution` | `true` | Show Run and Debug code lenses on specifications. |
| `gauge.kotlin.template` | `gradle` | Build tool offered first when creating a project. |
| `gauge.formatting.skipEmptyLineInsertions` | `false` | Skip adding empty lines while formatting. |
| `gauge.semanticTokenColors.*` | Monokai-like | Colors for Gauge tokens: `gauge.semanticTokenColors.argument`, `gauge.semanticTokenColors.dynamicArgument`, `gauge.semanticTokenColors.stepMarker`, `gauge.semanticTokenColors.step`, `gauge.semanticTokenColors.table`, `gauge.semanticTokenColors.tableHeader`, `gauge.semanticTokenColors.tableHeaderSeparator`, `gauge.semanticTokenColors.tableBorder`, `gauge.semanticTokenColors.tableKeyword`, `gauge.semanticTokenColors.tableFileValue`, `gauge.semanticTokenColors.tagKeyword`, `gauge.semanticTokenColors.tagValue`, `gauge.semanticTokenColors.specification`, `gauge.semanticTokenColors.scenario`, `gauge.semanticTokenColors.comment`, `gauge.semanticTokenColors.disabledStep`. |

## Known limitations

- The Gauge Java runner builds its step registry once, by reflection over the
  compiled classes, when the language server starts. A step added or renamed in
  Kotlin after that is reported as implemented by this extension's own analysis
  but can still be unknown to `gauge run` until the project is rebuilt.
- A `@Step` in a Kotlin file that is not compiled into the test classpath is
  treated as implemented by the local analysis.
- Gauge environment properties are read from `env/default`. A `gauge_specs_dir`
  or `gauge_data_dir` overridden in another environment is not picked up by the
  editor.

## License

MIT. See [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
