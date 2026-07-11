# Stable definitions and validation classpath recovery

## Scope

Keep local and dependency Step navigation available when the Gauge language
client changes state, and prevent false `gauge.validate` missing implementation
diagnostics when a JVM project classpath is temporarily unavailable.

## Root causes

Local definition resolution was owned only by language client middleware. This
avoided duplicate definition locations, but also tied local Kotlin, Java,
concept, and dependency navigation to the Gauge LSP client lifecycle.

The validation provider cached the first project environment even when Maven or
Gradle classpath calculation returned an empty environment. Every later
`gauge validate` invocation then ran without `gauge_custom_classpath` and
reported valid compiled Step implementations as missing.

## RED

Command:

```sh
node --test --test-name-pattern 'keeps local Gauge definitions independent|retries an unavailable JVM classpath|suppresses LSP definitions owned by the stable local provider' test/extension.test.js test/validateDiagnostics.test.js test/gaugeWorkspace.test.js
```

Result: 0 passed and 3 failed. Activation registered no stable definition
provider, middleware could not suppress its duplicate LSP result, and
validation emitted a false missing implementation diagnostic from an empty
classpath environment.

## GREEN

Command:

```sh
node --test --test-name-pattern 'keeps local Gauge definitions independent|retries an unavailable JVM classpath|suppresses LSP definitions owned by the stable local provider' test/extension.test.js test/validateDiagnostics.test.js test/gaugeWorkspace.test.js
```

Result: 3 passed and 0 failed.

Relevant suite:

```sh
node --test test/extension.test.js test/gaugeWorkspace.test.js test/validateDiagnostics.test.js test/stepDefinitionProvider.test.js test/dependencyStepIndex.test.js
```

Result: 122 passed and 0 failed.

Broader command:

```sh
npm run check
```

Result: passed with syntax and lint checks, 1,011 unit tests, 34 LSP tests, 53
VS Code surface tests, and a successful VSIX package build.

## Real project evidence

The target project declares the Java Gauge runner while implementing Steps in
Kotlin compiled by Maven. Running `gauge validate` without the lowercase
`gauge_custom_classpath` reproduced missing implementation errors for both
project and dependency Steps. Running it with the classpath returned by
`mvn -q gauge:classpath` produced `No errors found`.

## Implementation

- Register one stable local definition provider outside the language client.
- Share that provider with middleware so Gauge LSP returns no duplicate when a
  local definition exists.
- Keep Gauge LSP fallback definitions when no local definition exists.
- Do not run JVM Gauge validation while its project classpath is unavailable.
- Cache only usable JVM classpath environments, allowing later refreshes to
  recover after Maven or Gradle becomes available.

This supersedes the middleware-only ownership model recorded in
`2026-07-11-single-definition-middleware.md`.
