# Machine-readable debug attach

## Reference source

- `references/gauge-vscode/src/execution/lineProcessors.ts`

Gauge debug output can be delivered as normal stdout or as machine-readable
`out` events. The VS Code extension must attach to the runner process when the
debug-ready message arrives through either path.

## RED

Command:

```sh
node --test test/execution/lineProcessors.test.js -t "DebuggerAttachedEventProcessor reads process id from machine-readable output"
```

Result: failed. `DebuggerAttachedEventProcessor` passed `NaN` to
`addProcessId` when the debug-ready line was wrapped in a JSON `out` event.

## GREEN

Command:

```sh
node --test test/execution/lineProcessors.test.js -t "DebuggerAttachedEventProcessor reads process id from machine-readable output"
```

Result: passed.

## Regression

Command:

```sh
node --test test/execution/lineProcessors.test.js
```

Result: passed, 11 tests.

Command:

```sh
npm run check
```

Result: passed.
