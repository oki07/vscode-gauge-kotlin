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
