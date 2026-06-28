# Plain project classpath environment

## Scope

Add `gauge_custom_classpath` support for plain JVM Gauge projects and pass project environments to normal Gauge executions.

The VS Code extension has no IntelliJ module model, so the plain project classpath is derived from existing project source/output directories, project `libs` jars, and Gauge plugin jars.

## RED

Command:

```sh
node --test test/project.test.js test/execution/executor.test.js
```

Result: failed as expected.

Failing expectations:

- `GaugeProject.envs()` returned `{}` for a plain JVM Gauge project with classpath entries.
- Normal Gauge execution did not call `project.envs(cli)` and did not pass `gauge_custom_classpath` to the runner environment.

## GREEN

Command:

```sh
node --test test/project.test.js test/projectFactory.test.js test/execution/executor.test.js test/gaugeWorkspace.test.js test/validateDiagnostics.test.js
```

Result: passed, 65/65 tests.

## Broader checks

Command:

```sh
npm run check
```

Result: passed. Unit tests passed 561/561, LSP tests passed 20/20, VS Code tests passed 23/23, and package creation succeeded.
