const assert = require("node:assert/strict");
const test = require("node:test");

function createFakeVscode() {
  const commands = [];
  const information = [];
  const registered = [];
  return {
    calls: { commands, information, registered },
    vscode: {
      Uri: {
        parse(uri) {
          return { fsPath: uri.replace("file://", ""), uri };
        },
      },
      CancellationTokenSource: class CancellationTokenSource {
        constructor() {
          this.token = { cancelled: false };
        }
      },
      commands: {
        executeCommand(command, ...args) {
          commands.push({ command, args });
          return Promise.resolve(true);
        },
        registerCommand(command, handler) {
          registered.push({ command, handler });
          return { dispose() {} };
        },
      },
      window: {
        activeTextEditor: {
          selection: { active: { line: 4, character: 2 } },
          document: {
            uri: {
              fsPath: "/workspace/tests/Steps.kt",
              toString() {
                return "file:///workspace/tests/Steps.kt";
              },
            },
          },
        },
        showInformationMessage(message) {
          information.push(message);
          return Promise.resolve(undefined);
        },
      },
    },
  };
}

function createClient(responses, calls) {
  return {
    sendRequest(method, params, token) {
      calls.push({ method, params, token });
      return Promise.resolve(responses[method]);
    },
    protocol2CodeConverter: {
      asPosition(position) {
        return { ...position, converted: "position" };
      },
      asLocation(location) {
        return { ...location, converted: "location" };
      },
    },
  };
}

test("ReferenceProvider shows references for the step at the active cursor", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const { GaugeProject } = require("../src/project/gaugeProject");
  const requestCalls = [];
  const { calls, vscode } = createFakeVscode();
  const clients = new GaugeClients();
  const client = createClient({
    "gauge/stepValueAt": "Say hello",
    "gauge/stepReferences": [
      { uri: "file:///workspace/specs/example.spec", range: { start: { line: 2, character: 0 } } },
    ],
  }, requestCalls);
  clients.set("/workspace", {
    project: new GaugeProject("/workspace", { Language: "kotlin", Plugins: [] }),
    client,
  });

  const provider = new ReferenceProvider(clients, { vscode });
  const result = await provider.showStepReferencesAtCursor();

  assert.equal(result, true);
  assert.deepEqual(requestCalls.map((entry) => entry.method), [
    "gauge/stepValueAt",
    "gauge/stepReferences",
  ]);
  assert.deepEqual(requestCalls[0].params, {
    textDocument: { uri: "file:///workspace/tests/Steps.kt" },
    position: { line: 4, character: 2 },
  });
  assert.equal(requestCalls[1].params, "Say hello");
  assert.deepEqual(calls.commands, [
    {
      command: "editor.action.showReferences",
      args: [
        { fsPath: "/workspace/tests/Steps.kt", uri: "file:///workspace/tests/Steps.kt" },
        { line: 4, character: 2, converted: "position" },
        [
          {
            uri: "file:///workspace/specs/example.spec",
            range: { start: { line: 2, character: 0 } },
            converted: "location",
          },
        ],
      ],
    },
  ]);
});

test("ReferenceProvider reports when no step references are available", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const { GaugeProject } = require("../src/project/gaugeProject");
  const { calls, vscode } = createFakeVscode();
  const clients = new GaugeClients();
  const client = createClient({ "gauge/stepReferences": null }, []);
  clients.set("/workspace", {
    project: new GaugeProject("/workspace", { Language: "kotlin", Plugins: [] }),
    client,
  });

  const provider = new ReferenceProvider(clients, { vscode });
  const result = await provider.showStepReferences(
    "file:///workspace/tests/Steps.kt",
    { line: 4, character: 2 },
    "not a step",
  );

  assert.equal(result, false);
  assert.deepEqual(calls.information, ["Action NA: Try this on an implementation."]);
});

test("ReferenceProvider registers reference commands", () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const { calls, vscode } = createFakeVscode();

  new ReferenceProvider(new GaugeClients(), { vscode });

  assert.deepEqual(calls.registered.map((entry) => entry.command), [
    "gauge.showReferences.atCursor",
    "gauge.showReferences",
  ]);
});
