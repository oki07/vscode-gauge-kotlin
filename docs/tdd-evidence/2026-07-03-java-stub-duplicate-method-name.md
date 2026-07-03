# Java Stub Duplicate Method Name TDD Evidence

## Scope

Generating a Java step stub into an existing implementation file should avoid
reusing an existing `implementation` method name.

## Source-only Reference Context

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/annotator/CreateStepImplFix.java`
  chooses `implementation1`, `implementation2`, and so on when the target Java
  class already has matching method names.
- `vscode-gauge-kotlin/src/annotator/generateStub.js` already avoided duplicate
  names for selected Kotlin files, but returned Java stubs unchanged.

## RED

Command:

```sh
node --test --test-name-pattern "duplicate method names in selected Java files" test/generateStub.test.js
```

Result:

- Passed: 0
- Failed: 1

Failure summary:

- `GenerateStubCommandProvider avoids duplicate method names in selected Java files`
  expected `public void implementation1(...)`, but the generated request still
  sent `public void implementation(...)`.

## GREEN

Command:

```sh
node --test --test-name-pattern "duplicate method names in selected Java files" test/generateStub.test.js
```

Result:

- Passed: 1
- Failed: 0

Focused check:

```sh
node --test test/generateStub.test.js
```

Result:

- Passed: 7
- Failed: 0

Broader check:

```sh
npm run check
```

Result:

- Unit tests passed: 853
- LSP tests passed: 32
- VS Code extension tests passed: 48
- Failed: 0
- Package completed.

## Implementation Notes

- Added Java generated-method name detection for `public void implementation`.
- Added Java method-name collection for the selected implementation file.
- Reused the existing `stepImplementationName` selection policy so Java and
  Kotlin stubs both choose the next available `implementationN` name.
