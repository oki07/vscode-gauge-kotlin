# Changelog

All notable changes to the Gauge Kotlin extension are recorded here.

## 0.0.1

First release.

### Specifications and concepts

- Gauge specification, concept and Markdown specification languages, with syntax
  highlighting, semantic tokens, folding, document and workspace symbols.
- Diagnostics for undefined steps, `@Step` parameter count mismatches, malformed
  and misplaced tables, duplicate concepts, unresolved dynamic parameters and
  Gauge's own parse errors, arbitrated against the diagnostics Gauge publishes so
  a single mistake is reported once.
- Completion for steps, concepts, dynamic arguments and table columns.
- Formatting, line comment toggling, preview, concept extraction, and creation of
  specifications and concepts.

### Kotlin step implementations

- Definition, references and rename between specification steps and Kotlin
  `@Step` functions, across open and unopened workspace files.
- A quick fix that writes a missing Kotlin step implementation directly, because
  the Gauge Java runner's stub writer parses its target with a Java parser.
- Definition navigation and completion for compiled `@Step` methods in
  dependency JARs and imported class/archive directories, with read-only
  dependency declarations. Imported module/library scope and exclusions filter
  candidates; binary changes refresh definitions and diagnostics.
- Cooperation with Kotlin by JetBrains through its exported workspace model,
  including source roots outside the workspace and shared dependency consumers.
- Unreferenced `@Step` functions and unreferenced concepts are faded.
- Step text resolution through aliases, `typealias` chains, `const val`
  declarations, wildcard imports and Gauge multi-line arguments.

### Running specifications

- Test Explorer integration with run and debug profiles, per-scenario results,
  failure locations and Gauge's own output. A selection of several
  specifications or scenarios runs in one Gauge process.
- A Gauge Specs tree view, Run and Debug code lenses, and the Gauge run commands
  including rerun-failed, repeat, stop and open HTML report.
- Debugger attach to the runner JVM, with the classpath computed from the
  project's Gradle or Maven build and cached until a build or environment file
  changes.

### Project creation

- Bundled `kotlin_gradle` and `kotlin_maven` project templates. Gauge publishes
  no Kotlin template, so the extension ships its own and writes them directly.
