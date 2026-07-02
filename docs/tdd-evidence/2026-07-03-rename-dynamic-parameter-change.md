# Rename Dynamic Parameter Change

## Reference Sources

- `references/gauge/refactor/refactor.go`
- `references/gauge-java/src/test/java/com/thoughtworks/gauge/refactor/JavaRefactoringTest.java`
- `references/gauge-java/src/main/java/com/thoughtworks/gauge/refactor/RefactoringMethodVisitor.java`

## Gap

Gauge refactoring maps implementation parameters by matching old and new step
argument values. When a dynamic argument name changes from `<amount>` to
`<value>`, the new argument has no old position, so the implementation signature
is rebuilt with a new generated parameter. The VS Code Kotlin implementation
updated only the Step annotation and left `amount: String` in place.

## RED

Command:

```text
node --test --test-name-pattern "replaces Kotlin parameters when dynamic argument names change" test/renameProvider.test.js
```

Result:

```text
fail 1
missing Kotlin function parameter replacement: argValue: Any
```

## GREEN

Command:

```text
node --test --test-name-pattern "replaces Kotlin parameters when dynamic argument names change" test/renameProvider.test.js
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
pass 29
fail 0
```

## Broad Check

Command:

```text
npm run check
```

Result:

```text
test:unit pass 821 fail 0
test:lsp pass 32 fail 0
test:vscode pass 46 fail 0
package succeeded
```
