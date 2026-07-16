# Gradle Direct Gauge Execution TDD Evidence

## Scope

Kotlin Gradle projects should use Gradle only to compile test classes and
resolve the Gauge custom classpath. Scenario execution should then invoke the
configured Gauge executable directly so run-only flags are parsed by
`gauge run` instead of the Gradle Gauge plugin.

## Reference Behavior

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/GaugeCommandLine.java`
  selects the configured Gauge executable and working directory.
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/GaugeRunConfiguration.java`
  invokes `gauge run` and passes `--simple-console` directly.
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/execution/GaugeCommandLineState.java`
  injects the module classpath through `gauge_custom_classpath`.
- `references/gauge-vscode/src/project/projectFactory.ts` treats non-Java
  projects as generic Gauge projects, which keeps Kotlin execution on the
  direct Gauge CLI path.
- `references/gauge-vscode/src/project/gradleProject.ts` shows the Gradle
  `classpath` task used to resolve `gauge_custom_classpath`.

## Adaptation

`GradleProject` now separates its build command from its execution command.
The Gradle wrapper or system Gradle runs `-q testClasses classpath` before an
execution. The configured Gauge command then receives the standard direct
Gauge arguments and the resolved `gauge_custom_classpath` environment.

## RED

Command:

```sh
node --test --test-name-pattern "GradleProject prepares|execute Kotlin Gradle scenario" test/project.test.js test/execution/executor.test.js
```

Result:

- Passed: 0
- Failed: 2
- The project model returned `./gradlew` as the execution command.
- The controller ran `./gradlew -q clean classpath` and retained the Gradle
  Gauge execution path.

## GREEN

Command:

```sh
node --test --test-name-pattern "GradleProject prepares|execute Kotlin Gradle scenario" test/project.test.js test/execution/executor.test.js
```

Result:

- Passed: 2
- Failed: 0

Focused check:

```sh
node --test test/project.test.js test/execution/executor.test.js
```

Result:

- Passed: 70
- Failed: 0

## Broader Check

Command:

```sh
npm run check
```

Result:

- Unit tests passed: 1018
- LSP tests passed: 36
- VS Code extension tests passed: 54
- Failed: 0
- Package completed.
