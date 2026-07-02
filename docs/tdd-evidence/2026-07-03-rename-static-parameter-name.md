# Rename Static Parameter Name

## Reference Sources

- `references/gauge-lsp-tests/specifications/rename/step/java_impl.json`
- `references/gauge-lsp-tests/specifications/rename/step/dotnet_impl.json`
- `references/gauge/refactor/refactor.go`

## Gap

Gauge rename keeps a static spec argument such as `"aeiou"` in the spec text,
but uses the existing implementation parameter name in the implementation Step
annotation. The VS Code Kotlin implementation previously rewrote the Kotlin
annotation to `<aeiou>` instead of preserving `<vowelString>`.

## RED

Command:

```text
node --test --test-name-pattern "keeps existing Kotlin parameter names" test/renameProvider.test.js
```

Result:

```text
fail 1
actual Kotlin annotation replacement: Vowels in English language are <aeiou>
expected Kotlin annotation replacement: Vowels in English language are <vowelString>
```

## GREEN

Command:

```text
node --test --test-name-pattern "keeps existing Kotlin parameter names" test/renameProvider.test.js
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
pass 28
fail 0
```

## Broad Check

Command:

```text
npm run check
```

Result:

```text
test:unit pass 820 fail 0
test:lsp pass 32 fail 0
test:vscode pass 46 fail 0
package succeeded
```
