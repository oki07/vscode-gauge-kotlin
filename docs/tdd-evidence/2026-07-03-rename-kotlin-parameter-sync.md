# Rename Kotlin Parameter Sync

## Reference Sources

- `references/gauge-lsp-tests/specifications/rename/beforeExistingParam/java_impl.json`
- `references/gauge-java/src/main/java/com/thoughtworks/gauge/refactor/RefactoringMethodVisitor.java`
- `references/gauge/refactor/refactor.go`

## Gap

Gauge rename updates the implementation step annotation and the attached
implementation method parameters when the renamed step inserts a parameter
before an existing parameter. The VS Code implementation updated the Step
annotation text only, so the Kotlin function signature kept the stale parameter
list.

## RED

Command:

```text
node --test --test-name-pattern "updates Kotlin Step function parameters" test/renameProvider.test.js
```

Result:

```text
fail 1
actual annotation replacement: a basic step \"before\" \"param\"
missing Kotlin function parameter replacement
```

## GREEN

Command:

```text
node --test --test-name-pattern "updates Kotlin Step function parameters" test/renameProvider.test.js
```

Result:

```text
pass 1
fail 0
```

## Focused Check

Command:

```text
node --test test/renameProvider.test.js
```

Result:

```text
pass 26
fail 0
```

## Broad Check

Command:

```text
npm run check
```

Result:

```text
test:unit pass 818 fail 0
test:lsp pass 32 fail 0
test:vscode pass 46 fail 0
package succeeded
```
