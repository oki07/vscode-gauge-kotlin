const assert = require("node:assert/strict");
const test = require("node:test");

function createFakeVscode(overrides = {}) {
  return {
    CancellationTokenSource: class CancellationTokenSource {
      constructor() {
        this.token = { cancelled: false };
      }
    },
    Position: class Position {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
    },
    window: {
      activeTextEditor: overrides.activeTextEditor || {
        selection: { active: { line: 8, character: 2 } },
        document: {
          uri: {
            fsPath: "/workspace/specs/example.spec",
            toString() {
              return "file:///workspace/specs/example.spec";
            },
          },
        },
      },
    },
  };
}

function createClient(calls, response) {
  return {
    started: 0,
    start() {
      this.started += 1;
      return Promise.resolve(undefined);
    },
    sendRequest(method, params, token) {
      calls.push({ method, params, token });
      return Promise.resolve(response);
    },
  };
}

test("Gauge scenario provider requests the scenario at the active cursor", async () => {
  const { createGaugeScenariosProvider } = require("../../src/execution/scenarioProvider");
  const calls = [];
  const response = {
    heading: "Checkout order",
    executionIdentifier: "/workspace/specs/example.spec:8",
  };
  const client = createClient(calls, response);
  const clients = {
    get(fsPath) {
      assert.equal(fsPath, "/workspace/specs/example.spec");
      return { client };
    },
  };
  const vscode = createFakeVscode();
  const provider = createGaugeScenariosProvider(clients, { vscode });

  const result = await provider({
    atCursor: true,
    position: { line: 8, character: 2 },
    spec: "/workspace/specs/example.spec",
  });

  assert.equal(client.started, 1);
  assert.equal(result, response);
  assert.deepEqual(calls, [
    {
      method: "gauge/scenarios",
      params: {
        textDocument: { uri: "file:///workspace/specs/example.spec" },
        position: { line: 8, character: 2 },
      },
      token: { cancelled: false },
    },
  ]);
});

test("Gauge scenario provider requests all scenarios from the document start", async () => {
  const { createGaugeScenariosProvider } = require("../../src/execution/scenarioProvider");
  const calls = [];
  const response = [
    {
      heading: "First",
      executionIdentifier: "/workspace/specs/example.spec:4",
    },
  ];
  const client = createClient(calls, response);
  const vscode = createFakeVscode();
  const provider = createGaugeScenariosProvider(() => ({
    get() {
      return { client };
    },
  }), { vscode });

  const result = await provider({
    atCursor: false,
    position: { line: 8, character: 2 },
    spec: "/workspace/specs/example.spec",
  });

  assert.equal(result, response);
  assert.deepEqual(calls[0].params, {
    textDocument: { uri: "file:///workspace/specs/example.spec" },
    position: { line: 1, character: 1 },
  });
});
