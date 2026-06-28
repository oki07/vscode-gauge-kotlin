# Project initializer parity

## Scope

Align Gauge project creation with the supported VS Code extension scope:

- Reject unsupported Gauge versions before template lookup.
- Offer only Kotlin templates.
- Initialize an existing non-Gauge directory.
- Reject an existing Gauge project directory.

## RED

Command:

```sh
node --test test/projectInitializer.test.js
```

Result: failed as expected.

Failing expectations:

- Existing Gauge project directories still used the generic duplicate-folder error.
- Existing non-Gauge directories were rejected instead of initialized.
- Unsupported Gauge versions still proceeded to template lookup and initialization.
- Non-Kotlin templates were still shown in the template picker.

## GREEN

Command:

```sh
node --test test/projectInitializer.test.js
```

Result: passed, 9/9 tests.

## Broader checks

Command:

```sh
node --test test/projectInitializer.test.js test/extension.test.js test/manifest.test.js
```

Result: passed, 32/32 tests.

Command:

```sh
npm run check
```

Result: passed. Unit tests passed 559/559, LSP tests passed 20/20, VS Code tests passed 23/23, and package creation succeeded.
