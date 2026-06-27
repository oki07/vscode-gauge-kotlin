const assert = require("node:assert/strict");
const test = require("node:test");

function createFakeVscode(overrides = {}) {
  const commands = [];
  const information = [];
  const registered = [];
  const activeText = overrides.activeText || "";
  const activeDocument = overrides.activeDocument || {
    languageId: "kotlin",
    uri: {
      fsPath: "/workspace/tests/Steps.kt",
      toString() {
        return "file:///workspace/tests/Steps.kt";
      },
    },
    getText() {
      return activeText;
    },
  };
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
          selection: { active: overrides.activePosition || { line: 4, character: 2 } },
          document: activeDocument,
        },
        showInformationMessage(message) {
          information.push(message);
          return Promise.resolve(undefined);
        },
      },
      workspace: overrides.workspace || {},
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

test("ReferenceProvider does not show references outside step context", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const { GaugeProject } = require("../src/project/gaugeProject");
  const requestCalls = [];
  const { calls, vscode } = createFakeVscode();
  const clients = new GaugeClients();
  const client = createClient({
    "gauge/stepValueAt": null,
    "gauge/stepReferences": null,
  }, requestCalls);
  clients.set("/workspace", {
    project: new GaugeProject("/workspace", { Language: "kotlin", Plugins: [] }),
    client,
  });

  const provider = new ReferenceProvider(clients, { vscode });
  const result = await provider.showStepReferencesAtCursor();

  assert.equal(result, false);
  assert.deepEqual(requestCalls.map((entry) => entry.method), [
    "gauge/stepValueAt",
    "gauge/stepReferences",
  ]);
  assert.equal(requestCalls[1].params, null);
  assert.deepEqual(calls.commands, []);
  assert.deepEqual(calls.information, ["Action NA: Try this on an implementation."]);
});

test("ReferenceProvider falls back to Kotlin Step aliases at the active cursor", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const { GaugeProject } = require("../src/project/gaugeProject");
  const requestCalls = [];
  const { calls, vscode } = createFakeVscode({
    activePosition: { line: 3, character: 5 },
    activeText: [
      "import com.thoughtworks.gauge.Step",
      "",
      "@Step(\"Say hello to <name>\")",
      "fun say(name: String) {}",
    ].join("\n"),
  });
  const clients = new GaugeClients();
  const client = createClient({
    "gauge/stepValueAt": null,
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
  assert.equal(requestCalls[1].params, "Say hello to <name>");
  assert.deepEqual(calls.information, []);
  assert.equal(calls.commands[0].command, "editor.action.showReferences");
});

test("ReferenceProvider uses the Kotlin Step alias under the active cursor", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const { GaugeProject } = require("../src/project/gaugeProject");
  const requestCalls = [];
  const { calls, vscode } = createFakeVscode({
    activePosition: { line: 2, character: 33 },
    activeText: [
      "import com.thoughtworks.gauge.Step",
      "",
      "@Step(\"First alias <name>\", \"Second alias <name>\")",
      "fun say(name: String) {}",
    ].join("\n"),
  });
  const clients = new GaugeClients();
  const client = createClient({
    "gauge/stepValueAt": null,
    "gauge/stepReferences": [
      { uri: "file:///workspace/specs/second.spec", range: { start: { line: 4, character: 0 } } },
    ],
  }, requestCalls);
  clients.set("/workspace", {
    project: new GaugeProject("/workspace", { Language: "kotlin", Plugins: [] }),
    client,
  });

  const provider = new ReferenceProvider(clients, { vscode });
  const result = await provider.showStepReferencesAtCursor();

  assert.equal(result, true);
  assert.equal(requestCalls[1].method, "gauge/stepReferences");
  assert.equal(requestCalls[1].params, "Second alias <name>");
  assert.deepEqual(calls.information, []);
  assert.equal(calls.commands[0].command, "editor.action.showReferences");
});

test("ReferenceProvider falls back to unopened workspace Kotlin constants", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const { GaugeProject } = require("../src/project/gaugeProject");
  const requestCalls = [];
  const constantsDocument = {
    languageId: "kotlin",
    uri: { fsPath: "/workspace/tests/StepText.kt" },
    getText() {
      return [
        "package tests",
        "",
        "object StepText {",
        "  const val LOGIN = \"Log in as <user>\"",
        "}",
      ].join("\n");
    },
  };
  const activeDocument = {
    languageId: "kotlin",
    uri: {
      fsPath: "/workspace/tests/Steps.kt",
      toString() {
        return "file:///workspace/tests/Steps.kt";
      },
    },
    getText() {
      return [
        "package tests",
        "",
        "import com.thoughtworks.gauge.Step",
        "",
        "@Step(StepText.LOGIN)",
        "fun login(user: String) {}",
      ].join("\n");
    },
  };
  const { calls, vscode } = createFakeVscode({
    activeDocument,
    activePosition: { line: 5, character: 5 },
    workspace: {
      async findFiles(pattern) {
        assert.equal(pattern, "**/*.kt");
        return [constantsDocument.uri];
      },
      async openTextDocument(uri) {
        assert.equal(uri, constantsDocument.uri);
        return constantsDocument;
      },
      textDocuments: [activeDocument],
    },
  });
  const clients = new GaugeClients();
  const client = createClient({
    "gauge/stepValueAt": null,
    "gauge/stepReferences": [
      { uri: "file:///workspace/specs/login.spec", range: { start: { line: 3, character: 0 } } },
    ],
  }, requestCalls);
  clients.set("/workspace", {
    project: new GaugeProject("/workspace", { Language: "kotlin", Plugins: [] }),
    client,
  });

  const provider = new ReferenceProvider(clients, { vscode });
  const result = await provider.showStepReferencesAtCursor();

  assert.equal(result, true);
  assert.equal(requestCalls[1].method, "gauge/stepReferences");
  assert.equal(requestCalls[1].params, "Log in as <user>");
  assert.deepEqual(calls.information, []);
  assert.equal(calls.commands[0].command, "editor.action.showReferences");
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
