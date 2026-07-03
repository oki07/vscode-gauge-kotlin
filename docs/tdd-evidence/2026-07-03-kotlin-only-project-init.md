# Kotlin-only Project Initialization TDD Evidence

## Scope

Gauge Kotlin project creation must not offer or initialize non-Kotlin Gauge
templates. Existing Java Gauge project compatibility remains separate from the
Kotlin create-project flow.

## Source-only reference context

- `references/gauge-vscode/src/init/projectInit.ts` lists and initializes all
  Gauge templates.
- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/module/GaugeModuleBuilder.java`
  is Java-specific and initializes Java Gauge modules.
- The target extension exposes `gauge.kotlin.template`, so its create command
  should create Kotlin Gauge projects only.

## RED

Command:

```sh
node --test --test-name-pattern "Kotlin project templates|Kotlin templates are unavailable|non-Kotlin Gauge projects|template list parsing failures" test/projectInitializer.test.js
```

Result:

- Passed: 0
- Failed: 4

Failure summary:

- Non-Kotlin templates were still shown in the create-project picker.
- Missing Kotlin templates fell back to Java/JavaScript templates.
- A successful `gauge init` result was accepted without checking the generated
  manifest language.
- Empty template lists still reached `showQuickPick`.

## GREEN

Command:

```sh
node --test --test-name-pattern "Kotlin project templates|Kotlin templates are unavailable|non-Kotlin Gauge projects|template list parsing failures" test/projectInitializer.test.js
```

Result:

- Passed: 4
- Failed: 0

Focused check:

```sh
node --test test/projectInitializer.test.js
```

Result:

- Passed: 12
- Failed: 0

## Implementation Notes

- Filter template choices to Kotlin templates only and keep configured template
  preference ordering.
- Stop project creation before folder selection when no Kotlin template exists.
- Validate the generated `manifest.json` language after `gauge init`; reject
  and remove the created directory when it is not Kotlin.
