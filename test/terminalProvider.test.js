const assert = require("node:assert/strict");
const test = require("node:test");

test("TerminalProvider sends text to a new Gauge terminal and prompts reload", () => {
  const { TerminalProvider } = require("../src/terminalProvider");
  const commands = [];
  const terminals = [];
  const messages = [];
  const scheduled = [];
  const context = { subscriptions: [] };
  const vscode = {
    commands: {
      registerCommand(command, handler) {
        commands.push({ command, handler });
        return { dispose() {} };
      },
    },
    window: {
      createTerminal(name) {
        const terminal = {
          name,
          sent: [],
          shown: 0,
          sendText(text) {
            this.sent.push(text);
          },
          show() {
            this.shown += 1;
          },
        };
        terminals.push(terminal);
        return terminal;
      },
      showInformationMessage(message) {
        messages.push(message);
        return Promise.resolve(undefined);
      },
    },
  };

  new TerminalProvider(context, {
    setTimeout(callback, delay) {
      scheduled.push(delay);
      callback();
    },
    vscode,
  });

  assert.deepEqual(commands.map((entry) => entry.command), ["gauge.executeIn.terminal"]);
  commands[0].handler("gauge install kotlin");

  assert.equal(terminals.length, 1);
  assert.equal(terminals[0].name, "gauge install");
  assert.equal(terminals[0].shown, 1);
  assert.deepEqual(terminals[0].sent, ["gauge install kotlin"]);
  assert.deepEqual(scheduled, [1000]);
  assert.deepEqual(messages, ["Please reload the project after Gauge is installed!"]);
});

test("TerminalProvider disposal cancels reload prompts and ignores retained commands", async () => {
  const { TerminalProvider } = require("../src/terminalProvider");
  const commands = [];
  const messages = [];
  const terminals = [];
  const timers = [];
  let commandDisposeCalls = 0;
  const vscode = {
    commands: {
      registerCommand(command, handler) {
        commands.push({ command, handler });
        return {
          dispose() {
            commandDisposeCalls += 1;
          },
        };
      },
    },
    window: {
      createTerminal(name) {
        const terminal = {
          disposeCalls: 0,
          name,
          sent: [],
          shown: 0,
          dispose() {
            this.disposeCalls += 1;
          },
          sendText(text) {
            this.sent.push(text);
          },
          show() {
            this.shown += 1;
          },
        };
        terminals.push(terminal);
        return terminal;
      },
      showInformationMessage(message) {
        messages.push(message);
        return Promise.resolve(undefined);
      },
    },
  };
  const provider = new TerminalProvider({}, {
    clearTimeout(handle) {
      handle.clearCalls += 1;
    },
    setTimeout(callback, delay) {
      const handle = {
        callback,
        clearCalls: 0,
        delay,
      };
      timers.push(handle);
      return handle;
    },
    vscode,
  });
  const retainedHandler = commands[0].handler;

  const firstTimer = retainedHandler("gauge install kotlin");
  const secondTimer = retainedHandler("gauge install java");
  assert.equal(firstTimer, timers[0]);
  assert.equal(secondTimer, timers[1]);
  assert.equal(timers.length, 2);

  provider.dispose();
  provider.dispose();
  await Promise.resolve(timers[0].callback());
  await Promise.resolve(timers[1].callback());

  const directResult = provider.execute("gauge install ruby");
  const retainedResult = retainedHandler("gauge install html-report");

  assert.deepEqual({
    commandDisposeCalls,
    directResult,
    firstTimerClearCalls: timers[0].clearCalls,
    secondTimerClearCalls: timers[1].clearCalls,
    latestTerminal: provider.latestTerminal(),
    messages,
    providerTerminalCount: provider.terminals.length,
    retainedResult,
    terminalCreations: terminals.length,
    terminalDisposeCalls: terminals.map((terminal) => terminal.disposeCalls),
    timersCreated: timers.length,
  }, {
    commandDisposeCalls: 1,
    directResult: undefined,
    firstTimerClearCalls: 1,
    secondTimerClearCalls: 1,
    latestTerminal: undefined,
    messages: [],
    providerTerminalCount: 0,
    retainedResult: undefined,
    terminalCreations: 2,
    terminalDisposeCalls: [0, 0],
    timersCreated: 2,
  });
});

test("TerminalProvider stops setup when disposal occurs during terminal callbacks", () => {
  const { TerminalProvider } = require("../src/terminalProvider");

  for (const disposeDuring of ["create", "show", "send"]) {
    const scheduled = [];
    const sent = [];
    let commandDisposeCalls = 0;
    let provider;
    const terminal = {
      disposeCalls: 0,
      dispose() {
        this.disposeCalls += 1;
      },
      sendText(text) {
        sent.push(text);
        if (disposeDuring === "send") {
          provider.dispose();
        }
      },
      show() {
        if (disposeDuring === "show") {
          provider.dispose();
        }
      },
    };
    const vscode = {
      commands: {
        registerCommand(_command, handler) {
          vscode.handler = handler;
          return {
            dispose() {
              commandDisposeCalls += 1;
            },
          };
        },
      },
      window: {
        createTerminal() {
          if (disposeDuring === "create") {
            provider.dispose();
          }
          return terminal;
        },
      },
    };
    provider = new TerminalProvider({}, {
      setTimeout(callback, delay) {
        scheduled.push({ callback, delay });
        return scheduled[scheduled.length - 1];
      },
      vscode,
    });

    const result = vscode.handler("gauge install kotlin");

    assert.deepEqual({
      commandDisposeCalls,
      disposeDuring,
      latestTerminal: provider.latestTerminal(),
      result,
      scheduledCount: scheduled.length,
      sent,
      terminalDisposeCalls: terminal.disposeCalls,
    }, {
      commandDisposeCalls: 1,
      disposeDuring,
      latestTerminal: undefined,
      result: undefined,
      scheduledCount: 0,
      sent: disposeDuring === "send" ? ["gauge install kotlin"] : [],
      terminalDisposeCalls: 0,
    });
  }
});
