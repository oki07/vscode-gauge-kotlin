# Rename Remove Kotlin Parameters

## Reference Sources

- `references/gauge-lsp-tests/specifications/rename/step_in_concept/java_impl.json`
- `references/gauge-java/src/main/java/com/thoughtworks/gauge/refactor/RefactoringMethodVisitor.java`
- `references/gauge-java/src/main/java/com/thoughtworks/gauge/refactor/JavaRefactoring.java`

## Gap

Gauge refactoring rebuilds the implementation method parameters from the new
step parameter positions. When a step is renamed from a parameterized form to a
plain text form, the reference edit replaces the implementation parameter range
with an empty string. The VS Code Kotlin implementation updated the Gauge step
and Step annotation, but did not remove the Kotlin function parameter list
contents when the new step had no parameters.

## RED

Command:

```text
node --test test/renameProvider.test.js
```

Result:

```text
pass 29
fail 1
missing Kotlin function parameter deletion edit for rename with no step parameters
```

## GREEN

Command:

```text
node --test test/renameProvider.test.js
```

Result:

```text
pass 30
fail 0
```

## Focused Check

Command:

```text
node --test test/renameProvider.test.js
```

Result:

```text
pass 30
fail 0
```

## Broad Check

Command:

```text
npm run check
```

Result:

```text
test:unit pass 822 fail 0
test:lsp pass 32 fail 0
test:vscode pass 46 fail 0
package succeeded
```
