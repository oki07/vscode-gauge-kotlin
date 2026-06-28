# Concept Heading Static Argument Action

## Reference Behavior

IntelliJ `ConvertToDynamicArgIntention` is available for both `SpecStaticArg`
and `ConceptStaticArg`, so quoted concept heading arguments can be converted to
dynamic parameters.

## RED

Command:

```sh
npm run test:unit -- test/argumentCodeActions.test.js
```

Result: failed.

Evidence:

- `GaugeArgumentCodeActionProvider converts static concept heading arguments to dynamic parameters` failed.
- The provider returned no action for `# Shared "cart"` in a `.cpt` document.

## GREEN

Command:

```sh
npm run test:unit -- test/argumentCodeActions.test.js
```

Result: passed, 13/13 tests.

## Broader Check

Command:

```sh
npm run check
```

Result: passed.
