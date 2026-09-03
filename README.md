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

- The Gauge Java runner fills its step registry by reflection over the compiled
  classes each time a runner process starts, and afterwards updates it only from
  Java source, so a Kotlin `@Step` never reaches it incrementally. Runs started
  from this extension are not affected: a Gradle or Maven project is compiled
  first, and Gauge then starts a fresh runner over the classes it just built.
  What stays behind is the long-lived runner behind the language server, which
  answers step-validation questions for the rest of the session from what it
  reflected at startup; this extension's own Kotlin analysis overrides those
  answers before they reach the editor. A Gauge project with neither `pom.xml`
  nor `build.gradle` has no pre-run build, so there a step added after the last
  compile stays unknown to the run until you compile it yourself.
- This extension indexes every `.kt` and `.java` file under the project root,
  not only the files the build compiles. A `@Step` in a file outside the
  project's source sets - a scratch directory, or a generated copy under a build
  output directory - is treated as implemented: it gets no `Undefined Step`, and
  Gauge's own missing-implementation error for that line is suppressed as a
  stale runner verdict, so nothing in the editor flags it while `gauge run`
  fails on it. The Gauge Java runner bounds its own source scope to
  `src/main/java` and `src/test/java`, overridable with
  `gauge_custom_compile_dir`. Both bundled templates put step implementations in
  `src/test/kotlin`: under the Gradle template a `@Step` in `src/main/kotlin`
  does not compile, because `gauge-java` is a test dependency there, and the
  Maven template compiles `src/test/kotlin` only.
- The Gauge Java runner constructs the class that declares a step, with
  `Class.forName(name).getDeclaredConstructor().newInstance()`. Kotlin's file
  class has no constructor, and the constructors of an `object` and of a
  `companion object` are private, so a `@Step` written as a top-level function
  or inside an `object` or `companion object` registers and then fails at run
  time with a message about a constructor rather than about the step. This
  extension reports such a step as implemented, because it is - it just cannot
  be constructed by default. Put step implementations in a class with a
  no-argument constructor, as both bundled templates do, or supply a
  `ClassInitializer` implementation, which the runner picks up and uses instead.
- Always-on editor features read the default Gauge environment, including a
  manifest `EnvironmentDir` or relative `gauge_env_dir`. A `gauge_specs_dir` or
  `gauge_data_dir` overridden only by a launch configuration's non-default
  `--env` is not picked up by those editor features, and neither is it by the
  Gauge language server, which `gauge daemon` gives no environment flag. Setting
  the property in the environment VS Code itself runs in moves every surface
  together, because both Gauge and this extension read the process environment
  ahead of the properties file.

## License

MIT. See [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
