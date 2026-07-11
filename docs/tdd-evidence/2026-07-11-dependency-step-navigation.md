# Dependency Step navigation

## Scope

Resolve Gauge steps implemented in Maven or Gradle dependency JARs, navigate to
a readable virtual declaration, and avoid reporting those steps as undefined.

## Reference behavior

The IntelliJ Gauge plugin resolves a `StepReference` through
`StepUtil.findStepImpl`. That method searches annotated methods in
`GlobalSearchScope.moduleWithDependenciesAndLibrariesScope`, so the IDE Java
annotation index includes both project output and dependency libraries. The
Gauge language server is not responsible for finding the dependency method.

Reference paths:

- `gauge/src/com/thoughtworks/gauge/reference/StepReference.java`
- `gauge/src/com/thoughtworks/gauge/util/StepUtil.java`

The VS Code adaptation reads runtime `com.thoughtworks.gauge.Step` annotations
from class files on the Gauge project classpath. One shared index serves local
definition middleware and undefined-step diagnostics. Dependency methods are
opened through a read-only virtual document because VS Code has no IntelliJ PSI
decompiler surface.

## RED

Command:

```sh
node --test --test-name-pattern 'resolves dependency Step methods from the library index|accepts dependency steps from the library index' test/stepDefinitionProvider.test.js test/stepDiagnostics.test.js
```

Result: 0 passed and 2 failed. The definition provider did not query the
dependency index, and diagnostics reported `Undefined Step`.

Command:

```sh
node --test test/dependencyStepIndex.test.js
```

Result: 0 passed and 2 failed because the dependency class index module did not
exist.

Command:

```sh
node --test --test-name-pattern 'activation starts Gauge workspace services for Gauge projects' test/extension.test.js
```

Result: 0 passed and 1 failed because activation did not create and share a
dependency index.

Command:

```sh
node --test --test-name-pattern 'refreshes the dependency index before diagnostics' test/stepDiagnostics.test.js
```

Result: 0 passed and 1 failed. Diagnostics ran before dependency indexing and,
after initial wiring, a dependency-only project still returned `Undefined
Step`.

## GREEN

Commands:

```sh
node --test test/dependencyStepIndex.test.js
node --test --test-name-pattern 'activation starts Gauge workspace services for Gauge projects|refreshes the dependency index before diagnostics|resolves dependency Step methods from the library index|accepts dependency steps from the library index' test/extension.test.js test/stepDiagnostics.test.js test/stepDefinitionProvider.test.js
node --test test/dependencyStepIndex.test.js test/stepDefinitionProvider.test.js test/stepDiagnostics.test.js test/gaugeWorkspace.test.js test/extension.test.js
```

Results: the dependency class parser and virtual declaration tests passed 2 of
2, the targeted integration tests passed 4 of 4, and the combined relevant
suite passed 366 of 366.

Broader command:

```sh
npm run check
```

Result: passed with syntax and lint checks, 1,009 unit tests, 33 LSP tests, 53
VS Code surface tests, and a successful VSIX package build.

## Real project evidence

`mvn -q gauge:classpath` for the target project included both `playtest-core`
and `playtest-http`. Scanning those two dependency JARs produced 26 normalized
Gauge Step templates. Those templates matched 90 Step usages in the project's
current specification and concept files. Scanning the complete Maven
classpath produced the same 26 templates.
