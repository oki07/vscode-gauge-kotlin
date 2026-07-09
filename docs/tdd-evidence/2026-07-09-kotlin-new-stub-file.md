# Kotlin new stub file creation

## Reference source

- `references/intellij-gauge-plugin/src/com/thoughtworks/gauge/annotator/CreateStepImplFix.java`
- `references/gauge-vscode/src/annotator/generateStub.ts`

Undefined step quick fixes must be able to target a new implementation file.
For Kotlin projects, the selected `src/test/kotlin/*.kt` file should exist
before the stub generation request is sent to Gauge.

## RED

Command:

```sh
node --test test/generateStub.test.js -t "GenerateStubCommandProvider creates missing Kotlin files before requesting generated edits"
```

Result: failed. The `.kt` implementation file did not exist when
`gauge/putStubImpl` was requested.

## GREEN

Command:

```sh
node --test test/generateStub.test.js -t "GenerateStubCommandProvider creates missing Kotlin files before requesting generated edits"
```

Result: passed.

## Regression

Command:

```sh
node --test test/generateStub.test.js
```

Result: passed, 8 tests.

Command:

```sh
npm run check
```

Result: passed.
