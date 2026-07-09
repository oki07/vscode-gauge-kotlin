# Definition Concept Priority

## Reference

- `references/gauge/api/lang/definition.go` calls `searchConcept` before `searchStep`.
- A step that matches both a concept heading and an implementation should resolve to the concept heading first.

## RED

Command:

```sh
node --test test/stepDefinitionProvider.test.js
```

Result: failed with 1 test because a step matching both `# Pay with <method>` and `@Step("Pay with <method>")` resolved to the Kotlin function instead of the concept heading.

## GREEN

Command:

```sh
node --test test/stepDefinitionProvider.test.js
```

Result: passed with 32 tests.
