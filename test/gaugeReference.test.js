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

test("ReferenceProvider falls back to local Gauge references for Kotlin Step aliases", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const { GaugeProject } = require("../src/project/gaugeProject");
  const requestCalls = [];
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
        "import com.thoughtworks.gauge.Step",
        "",
        "@Step(\"Say hello to <name>\")",
        "fun say(name: String) {}",
      ].join("\n");
    },
  };
  const specDocument = {
    languageId: "gauge",
    uri: {
      fsPath: "/workspace/specs/example.spec",
      toString() {
        return "file:///workspace/specs/example.spec";
      },
    },
    getText() {
      return [
        "# Example",
        "",
        "## Scenario",
        "* Say hello to \"alice\"",
      ].join("\n");
    },
  };
  const { calls, vscode } = createFakeVscode({
    activeDocument,
    activePosition: { line: 3, character: 5 },
    workspace: {
      async findFiles(pattern) {
        if (pattern === "**/*.kt" || pattern === "**/*.spec" || pattern === "**/*.cpt" || pattern === "**/*.md") {
          return [];
        }
        throw new Error(`unexpected findFiles pattern: ${pattern}`);
      },
      async openTextDocument() {
        throw new Error("no unopened files should be opened");
      },
      textDocuments: [activeDocument, specDocument],
    },
  });
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

  assert.equal(result, true);
  assert.equal(requestCalls[1].method, "gauge/stepReferences");
  assert.equal(requestCalls[1].params, "Say hello to <name>");
  assert.deepEqual(calls.information, []);
  assert.deepEqual(calls.commands, [
    {
      command: "editor.action.showReferences",
      args: [
        { fsPath: "/workspace/tests/Steps.kt", uri: "file:///workspace/tests/Steps.kt" },
        { line: 3, character: 5, converted: "position" },
        [
          {
            uri: "file:///workspace/specs/example.spec",
            range: {
              start: { line: 3, character: 0 },
              end: { line: 3, character: 22 },
            },
            converted: "location",
          },
        ],
      ],
    },
  ]);
});

test("ReferenceProvider provides local references for Kotlin Step aliases", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const { GaugeProject } = require("../src/project/gaugeProject");
  const requestCalls = [];
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
        "import com.thoughtworks.gauge.Step",
        "",
        "@Step(\"Say hello to <name>\")",
        "fun say(name: String) {}",
      ].join("\n");
    },
  };
  const specDocument = {
    languageId: "gauge",
    uri: {
      fsPath: "/workspace/specs/example.spec",
      toString() {
        return "file:///workspace/specs/example.spec";
      },
    },
    getText() {
      return [
        "# Example",
        "",
        "## Scenario",
        "* Say hello to \"alice\"",
      ].join("\n");
    },
  };
  const { vscode } = createFakeVscode({
    activeDocument,
    activePosition: { line: 3, character: 5 },
    workspace: {
      async findFiles(pattern) {
        if (pattern === "**/*.kt" || pattern === "**/*.spec" || pattern === "**/*.cpt" || pattern === "**/*.md") {
          return [];
        }
        throw new Error(`unexpected findFiles pattern: ${pattern}`);
      },
      async openTextDocument() {
        throw new Error("no unopened files should be opened");
      },
      textDocuments: [activeDocument, specDocument],
    },
  });
  const clients = new GaugeClients();
  const client = createClient({
    "gauge/stepReferences": null,
  }, requestCalls);
  clients.set("/workspace", {
    project: new GaugeProject("/workspace", { Language: "kotlin", Plugins: [] }),
    client,
  });

  const provider = new ReferenceProvider(clients, { vscode });
  const result = await provider.provideReferences(
    activeDocument,
    { line: 3, character: 5 },
  );

  assert.deepEqual(requestCalls.map((entry) => entry.method), [
    "gauge/stepReferences",
  ]);
  assert.equal(requestCalls[0].params, "Say hello to <name>");
  assert.deepEqual(result, [
    {
      uri: "file:///workspace/specs/example.spec",
      range: {
        start: { line: 3, character: 0 },
        end: { line: 3, character: 22 },
      },
      converted: "location",
    },
  ]);
});

test("ReferenceProvider provides local references from Gauge step cursor without LSP", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const specDocument = {
    languageId: "gauge",
    uri: {
      fsPath: "/workspace/specs/example.spec",
      toString() {
        return "file:///workspace/specs/example.spec";
      },
    },
    getText() {
      return [
        "# Example",
        "",
        "## Scenario",
        "* Say hello to \"alice\"",
      ].join("\n");
    },
    lineAt(line) {
      return { text: this.getText().split(/\r?\n/)[line] || "" };
    },
  };
  const otherSpecDocument = {
    languageId: "gauge",
    uri: {
      fsPath: "/workspace/specs/other.spec",
      toString() {
        return "file:///workspace/specs/other.spec";
      },
    },
    getText() {
      return [
        "# Other",
        "",
        "## Scenario",
        "* Say hello to \"bob\"",
      ].join("\n");
    },
  };
  const { vscode } = createFakeVscode({
    workspace: {
      textDocuments: [specDocument, otherSpecDocument],
    },
  });
  const provider = new ReferenceProvider(new GaugeClients(), { vscode });

  const result = await provider.provideReferences(
    specDocument,
    { line: 3, character: 5 },
  );

  assert.deepEqual(result, [
    {
      uri: "file:///workspace/specs/example.spec",
      range: {
        start: { line: 3, character: 0 },
        end: { line: 3, character: 22 },
      },
    },
    {
      uri: "file:///workspace/specs/other.spec",
      range: {
        start: { line: 3, character: 0 },
        end: { line: 3, character: 20 },
      },
    },
  ]);
});

test("ReferenceProvider accepts plaintext .kt documents for local Kotlin Step references", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const { GaugeProject } = require("../src/project/gaugeProject");
  const requestCalls = [];
  const activeDocument = {
    languageId: "plaintext",
    uri: {
      fsPath: "/workspace/tests/Steps.kt",
      toString() {
        return "file:///workspace/tests/Steps.kt";
      },
    },
    getText() {
      return [
        "import com.thoughtworks.gauge.Step",
        "",
        "@Step(\"Say hello to <name>\")",
        "fun say(name: String) {}",
      ].join("\n");
    },
  };
  const specDocument = {
    languageId: "gauge",
    uri: {
      fsPath: "/workspace/specs/example.spec",
      toString() {
        return "file:///workspace/specs/example.spec";
      },
    },
    getText() {
      return [
        "# Example",
        "",
        "## Scenario",
        "* Say hello to \"alice\"",
      ].join("\n");
    },
  };
  const { calls, vscode } = createFakeVscode({
    activeDocument,
    activePosition: { line: 3, character: 5 },
    workspace: {
      async findFiles(pattern) {
        if (pattern === "**/*.kt" || pattern === "**/*.spec" || pattern === "**/*.cpt" || pattern === "**/*.md") {
          return [];
        }
        throw new Error(`unexpected findFiles pattern: ${pattern}`);
      },
      async openTextDocument() {
        throw new Error("no unopened files should be opened");
      },
      textDocuments: [activeDocument, specDocument],
    },
  });
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

  assert.equal(result, true);
  assert.equal(requestCalls[1].params, "Say hello to <name>");
  assert.deepEqual(calls.information, []);
  assert.equal(calls.commands[0].args[2][0].uri, "file:///workspace/specs/example.spec");
});

test("ReferenceProvider includes concept headings in local Step references", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const kotlinDocument = {
    languageId: "kotlin",
    uri: {
      fsPath: "/workspace/tests/Steps.kt",
      toString() {
        return "file:///workspace/tests/Steps.kt";
      },
    },
    getText() {
      return [
        "import com.thoughtworks.gauge.Step",
        "",
        "@Step(\"Log in as <user>\")",
        "fun login(user: String) {}",
      ].join("\n");
    },
  };
  const specDocument = {
    languageId: "gauge",
    uri: {
      fsPath: "/workspace/specs/login.spec",
      toString() {
        return "file:///workspace/specs/login.spec";
      },
    },
    getText() {
      return [
        "# Login",
        "",
        "## Scenario",
        "* Log in as \"alice\"",
      ].join("\n");
    },
  };
  const conceptDocument = {
    languageId: "gauge",
    uri: {
      fsPath: "/workspace/concepts/login.cpt",
      toString() {
        return "file:///workspace/concepts/login.cpt";
      },
    },
    getText() {
      return [
        "# Log in as <user>",
        "* Enter username",
      ].join("\n");
    },
  };
  const { vscode } = createFakeVscode({
    workspace: {
      textDocuments: [kotlinDocument, specDocument, conceptDocument],
    },
  });
  const provider = new ReferenceProvider(new GaugeClients(), { vscode });

  const result = await provider.provideReferences(
    kotlinDocument,
    { line: 3, character: 5 },
  );

  assert.deepEqual(result, [
    {
      uri: "file:///workspace/specs/login.spec",
      range: {
        start: { line: 3, character: 0 },
        end: { line: 3, character: 19 },
      },
    },
    {
      uri: "file:///workspace/concepts/login.cpt",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 18 },
      },
    },
  ]);
});

test("ReferenceProvider resolves package wildcard const Step aliases for local references", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const { GaugeProject } = require("../src/project/gaugeProject");
  const requestCalls = [];
  const constantsDocument = {
    languageId: "kotlin",
    uri: { fsPath: "/workspace/gauge/src/test/kotlin/fixtures/steps/StepText.kt" },
    getText() {
      return [
        "package fixtures.steps",
        "",
        "const val LOGIN_STEP = \"Log in as <user>\"",
      ].join("\n");
    },
  };
  const activeDocument = {
    languageId: "kotlin",
    uri: {
      fsPath: "/workspace/gauge/src/test/kotlin/fixtures/impl/LoginSteps.kt",
      toString() {
        return "file:///workspace/gauge/src/test/kotlin/fixtures/impl/LoginSteps.kt";
      },
    },
    getText() {
      return [
        "package fixtures.impl",
        "",
        "import com.thoughtworks.gauge.Step",
        "import fixtures.steps.*",
        "",
        "@Step(LOGIN_STEP)",
        "fun login(user: String) {}",
      ].join("\n");
    },
  };
  const specDocument = {
    languageId: "gauge",
    uri: {
      fsPath: "/workspace/gauge/specs/login.spec",
      toString() {
        return "file:///workspace/gauge/specs/login.spec";
      },
    },
    getText() {
      return [
        "# Login",
        "",
        "## Scenario",
        "* Log in as \"alice\"",
      ].join("\n");
    },
  };
  const { calls, vscode } = createFakeVscode({
    activeDocument,
    activePosition: { line: 6, character: 5 },
    workspace: {
      async findFiles(pattern) {
        if (pattern === "**/*.kt" || pattern === "**/*.spec" || pattern === "**/*.cpt" || pattern === "**/*.md") {
          return [];
        }
        throw new Error(`unexpected findFiles pattern: ${pattern}`);
      },
      async openTextDocument() {
        throw new Error("no unopened files should be opened");
      },
      textDocuments: [activeDocument, constantsDocument, specDocument],
    },
  });
  const clients = new GaugeClients();
  const client = createClient({
    "gauge/stepValueAt": null,
    "gauge/stepReferences": null,
  }, requestCalls);
  clients.set("/workspace/gauge", {
    project: new GaugeProject("/workspace/gauge", { Language: "kotlin", Plugins: [] }),
    client,
  });

  const provider = new ReferenceProvider(clients, { vscode });
  const result = await provider.showStepReferencesAtCursor();

  assert.equal(result, true);
  assert.equal(requestCalls[1].method, "gauge/stepReferences");
  assert.equal(requestCalls[1].params, "Log in as <user>");
  assert.deepEqual(calls.information, []);
  assert.deepEqual(calls.commands, [
    {
      command: "editor.action.showReferences",
      args: [
        {
          fsPath: "/workspace/gauge/src/test/kotlin/fixtures/impl/LoginSteps.kt",
          uri: "file:///workspace/gauge/src/test/kotlin/fixtures/impl/LoginSteps.kt",
        },
        { line: 6, character: 5, converted: "position" },
        [
          {
            uri: "file:///workspace/gauge/specs/login.spec",
            range: {
              start: { line: 3, character: 0 },
              end: { line: 3, character: 19 },
            },
            converted: "location",
          },
        ],
      ],
    },
  ]);
});

test("ReferenceProvider resolves grouped and accessor Kotlin Step aliases for local references", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const { GaugeProject } = require("../src/project/gaugeProject");
  const cases = [
    {
      alias: "Grouped login as <user>",
      activePosition: { line: 6, character: 5 },
      kotlinLines: [
        "package fixtures.impl",
        "",
        "import com.thoughtworks.gauge.Step",
        "",
        "class LoginSteps {",
        "  @[Step(\"Grouped login as <user>\")]",
        "  fun grouped(user: String) {}",
        "}",
      ],
      step: "Grouped login as \"alice\"",
    },
    {
      alias: "Getter login as <user>",
      activePosition: { line: 7, character: 5 },
      kotlinLines: [
        "package fixtures.impl",
        "",
        "import com.thoughtworks.gauge.Step",
        "",
        "class LoginSteps {",
        "  val getterStep: String",
        "    @[Step(\"Getter login as <user>\")]",
        "    get() = \"\"",
        "}",
      ],
      step: "Getter login as \"alice\"",
    },
    {
      alias: "Setter login as <user>",
      activePosition: { line: 7, character: 5 },
      kotlinLines: [
        "package fixtures.impl",
        "",
        "import com.thoughtworks.gauge.Step",
        "",
        "class LoginSteps {",
        "  var setterStep: String = \"\"",
        "    @[Step(\"Setter login as <user>\")]",
        "    set(value) { field = value }",
        "}",
      ],
      step: "Setter login as \"alice\"",
    },
  ];

  for (const entry of cases) {
    const requestCalls = [];
    const activeDocument = {
      languageId: "kotlin",
      uri: {
        fsPath: "/workspace/gauge/src/test/kotlin/fixtures/impl/LoginSteps.kt",
        toString() {
          return "file:///workspace/gauge/src/test/kotlin/fixtures/impl/LoginSteps.kt";
        },
      },
      getText() {
        return entry.kotlinLines.join("\n");
      },
    };
    const specDocument = {
      languageId: "gauge",
      uri: {
        fsPath: "/workspace/gauge/specs/login.spec",
        toString() {
          return "file:///workspace/gauge/specs/login.spec";
        },
      },
      getText() {
        return [
          "# Login",
          "",
          "## Scenario",
          `* ${entry.step}`,
        ].join("\n");
      },
    };
    const { calls, vscode } = createFakeVscode({
      activeDocument,
      activePosition: entry.activePosition,
      workspace: {
        async findFiles(pattern) {
          if (pattern === "**/*.kt" || pattern === "**/*.spec" || pattern === "**/*.cpt" || pattern === "**/*.md") {
            return [];
          }
          throw new Error(`unexpected findFiles pattern: ${pattern}`);
        },
        async openTextDocument() {
          throw new Error("no unopened files should be opened");
        },
        textDocuments: [activeDocument, specDocument],
      },
    });
    const clients = new GaugeClients();
    const client = createClient({
      "gauge/stepValueAt": null,
      "gauge/stepReferences": null,
    }, requestCalls);
    clients.set("/workspace/gauge", {
      project: new GaugeProject("/workspace/gauge", { Language: "kotlin", Plugins: [] }),
      client,
    });

    const provider = new ReferenceProvider(clients, {
      projectFactory: {
        getGaugeRootFromFilePath(filename) {
          if (!filename.startsWith("/workspace/gauge/")) {
            throw new Error("not a Gauge project file");
          }
          return "/workspace/gauge";
        },
      },
      vscode,
    });
    const result = await provider.showStepReferencesAtCursor();

    assert.equal(result, true);
    assert.equal(requestCalls[1].method, "gauge/stepReferences");
    assert.equal(requestCalls[1].params, entry.alias);
    assert.equal(calls.commands[0].command, "editor.action.showReferences");
    assert.equal(calls.commands[0].args[2][0].uri, "file:///workspace/gauge/specs/login.spec");
    assert.deepEqual(calls.information, []);
  }
});

test("ReferenceProvider matches local Gauge inline table references for Kotlin Step aliases", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const { GaugeProject } = require("../src/project/gaugeProject");
  const requestCalls = [];
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
        "import com.thoughtworks.gauge.Step",
        "",
        "@Step(\"Compare <table>\")",
        "fun compare(table: Table) {}",
      ].join("\n");
    },
  };
  const specDocument = {
    languageId: "gauge",
    uri: {
      fsPath: "/workspace/specs/table.spec",
      toString() {
        return "file:///workspace/specs/table.spec";
      },
    },
    getText() {
      return [
        "# Table",
        "",
        "## Scenario",
        "* Compare",
        "  | name |",
        "  | bob  |",
      ].join("\n");
    },
  };
  const { calls, vscode } = createFakeVscode({
    activeDocument,
    activePosition: { line: 3, character: 5 },
    workspace: {
      async findFiles(pattern) {
        if (pattern === "**/*.kt" || pattern === "**/*.spec" || pattern === "**/*.cpt" || pattern === "**/*.md") {
          return [];
        }
        throw new Error(`unexpected findFiles pattern: ${pattern}`);
      },
      async openTextDocument() {
        throw new Error("no unopened files should be opened");
      },
      textDocuments: [activeDocument, specDocument],
    },
  });
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

  assert.equal(result, true);
  assert.equal(requestCalls[1].params, "Compare <table>");
  assert.deepEqual(calls.information, []);
  assert.equal(calls.commands[0].args[2][0].uri, "file:///workspace/specs/table.spec");
  assert.deepEqual(calls.commands[0].args[2][0].range, {
    start: { line: 3, character: 0 },
    end: { line: 3, character: 9 },
  });
});

test("ReferenceProvider falls back to unopened local Gauge references for Kotlin Step aliases", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const { GaugeProject } = require("../src/project/gaugeProject");
  const requestCalls = [];
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
        "import com.thoughtworks.gauge.Step",
        "",
        "@Step(\"Say hello to <name>\")",
        "fun say(name: String) {}",
      ].join("\n");
    },
  };
  const specDocument = {
    languageId: "gauge",
    uri: {
      fsPath: "/workspace/specs/unopened.spec",
      toString() {
        return "file:///workspace/specs/unopened.spec";
      },
    },
    getText() {
      return [
        "# Example",
        "",
        "## Scenario",
        "* Say hello to \"bob\"",
      ].join("\n");
    },
  };
  const { calls, vscode } = createFakeVscode({
    activeDocument,
    activePosition: { line: 3, character: 5 },
    workspace: {
      async findFiles(pattern) {
        if (pattern === "**/*.kt" || pattern === "**/*.cpt") {
          return [];
        }
        if (pattern === "**/*.spec") {
          return [specDocument.uri];
        }
        throw new Error(`unexpected findFiles pattern: ${pattern}`);
      },
      async openTextDocument(uri) {
        assert.equal(uri, specDocument.uri);
        return specDocument;
      },
      textDocuments: [activeDocument],
    },
  });
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

  assert.equal(result, true);
  assert.deepEqual(calls.information, []);
  assert.equal(calls.commands[0].args[2][0].uri, "file:///workspace/specs/unopened.spec");
});

test("ReferenceProvider falls back to unopened local Markdown Gauge references", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const { GaugeProject } = require("../src/project/gaugeProject");
  const requestCalls = [];
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
        "import com.thoughtworks.gauge.Step",
        "",
        "@Step(\"Say hello to <name>\")",
        "fun say(name: String) {}",
      ].join("\n");
    },
  };
  const markdownDocument = {
    languageId: "gauge",
    uri: {
      fsPath: "/workspace/specs/unopened.md",
      toString() {
        return "file:///workspace/specs/unopened.md";
      },
    },
    getText() {
      return [
        "# Example",
        "",
        "## Scenario",
        "* Say hello to \"bob\"",
      ].join("\n");
    },
  };
  const { calls, vscode } = createFakeVscode({
    activeDocument,
    activePosition: { line: 3, character: 5 },
    workspace: {
      async findFiles(pattern) {
        if (pattern === "**/*.kt" || pattern === "**/*.spec" || pattern === "**/*.cpt") {
          return [];
        }
        if (pattern === "**/*.md") {
          return [markdownDocument.uri];
        }
        throw new Error(`unexpected findFiles pattern: ${pattern}`);
      },
      async openTextDocument(uri) {
        assert.equal(uri, markdownDocument.uri);
        return markdownDocument;
      },
      textDocuments: [activeDocument],
    },
  });
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

  assert.equal(result, true);
  assert.deepEqual(calls.information, []);
  assert.equal(calls.commands[0].args[2][0].uri, "file:///workspace/specs/unopened.md");
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

test("ReferenceProvider filters unopened local Gauge references outside Gauge projects", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const { GaugeProject } = require("../src/project/gaugeProject");
  const requestCalls = [];
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
        "import com.thoughtworks.gauge.Step",
        "",
        "@Step(\"Say hello to <name>\")",
        "fun say(name: String) {}",
      ].join("\n");
    },
  };
  const outsideSpecUri = {
    fsPath: "/outside/specs/example.spec",
    toString() {
      return "file:///outside/specs/example.spec";
    },
  };
  const { calls, vscode } = createFakeVscode({
    activeDocument,
    activePosition: { line: 3, character: 5 },
    workspace: {
      async findFiles(pattern) {
        if (pattern === "**/*.kt" || pattern === "**/*.cpt") {
          return [];
        }
        if (pattern === "**/*.spec") {
          return [outsideSpecUri];
        }
        return [];
      },
      async openTextDocument() {
        throw new Error("out-of-project Gauge files should not be opened");
      },
      textDocuments: [activeDocument],
    },
  });
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
  assert.deepEqual(calls.information, ["Action NA: Try this on an implementation."]);
  assert.deepEqual(calls.commands, []);
});
