const assert = require("node:assert/strict");
const test = require("node:test");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function trackCancellationSources(vscode, sources, onConstruct) {
  vscode.CancellationTokenSource = class CancellationTokenSource {
    constructor() {
      this.cancelCalls = 0;
      this.disposeCalls = 0;
      this.token = { isCancellationRequested: false };
      sources.push(this);
      if (onConstruct) {
        onConstruct(this);
      }
    }

    cancel() {
      this.cancelCalls += 1;
      this.token.isCancellationRequested = true;
    }

    dispose() {
      this.disposeCalls += 1;
    }
  };
}

function plainLocations(value) {
  const locations = Array.isArray(value) ? value : [value];
  return locations.map((location) => ({
    uri: typeof location.uri === "string" ? location.uri : location.uri.uri,
    range: {
      start: { line: location.range.start.line, character: location.range.start.character },
      end: { line: location.range.end.line, character: location.range.end.character },
    },
  }));
}

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
      Position: class Position {
        constructor(line, character) {
          this.line = line;
          this.character = character;
        }
      },
      Range: class Range {
        constructor(start, end) {
          this.start = start;
          this.end = end;
        }
      },
      Location: class Location {
        constructor(uri, range) {
          this.uri = uri;
          this.range = range;
        }
      },
      CancellationTokenSource: class CancellationTokenSource {
        constructor() {
          this.token = { cancelled: false };
        }

        cancel() {
          this.token.cancelled = true;
        }

        dispose() {}
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

function createMultiProjectFactory() {
  return {
    getGaugeRootFromFilePath(filename) {
      if (filename.startsWith("/workspace/project-a/")) {
        return "/workspace/project-a";
      }
      if (filename.startsWith("/workspace/project-b/")) {
        return "/workspace/project-b";
      }
      throw new Error("not a Gauge project file");
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

test("ReferenceProvider uses the shared workspace step index for local references", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const document = {
    languageId: "kotlin",
    uri: {
      fsPath: "/workspace/tests/CartSteps.kt",
      toString() {
        return "file:///workspace/tests/CartSteps.kt";
      },
    },
    getText() {
      return [
        "@Step(\"Open cart\")",
        "fun openCart() {}",
      ].join("\n");
    },
  };
  const entry = {
    aliases: ["Open cart"],
    annotationEnd: 18,
    annotationStart: 0,
    declarationEnd: document.getText().length,
    declarationStart: 0,
  };
  const offsetPositions = [];
  document.offsetAt = (position) => {
    offsetPositions.push(position);
    return 10;
  };
  const location = {
    uri: "file:///workspace/specs/cart.spec",
    range: { start: { line: 2, character: 0 }, end: { line: 2, character: 11 } },
  };
  const calls = [];
  const { vscode } = createFakeVscode();
  const provider = new ReferenceProvider(new GaugeClients(), {
    vscode,
    workspaceStepIndex: {
      referenceLocationsForPath(sourcePath, template) {
        calls.push({ sourcePath, template });
        return [location];
      },
      referenceLocations(sourceDocument, template) {
        calls.push({ sourceDocument, template });
        return [location];
      },
      stepAliasesForEntry(sourceDocument, targetDocument, targetEntry) {
        assert.equal(sourceDocument, document);
        assert.equal(targetDocument, document);
        assert.equal(targetEntry, entry);
        return ["Open cart"];
      },
      stepEntriesForDocument(sourceDocument, targetDocument) {
        assert.equal(sourceDocument, document);
        assert.equal(targetDocument, document);
        return [entry];
      },
    },
  });
  provider.stepImplementationDocuments = () => {
    throw new Error("legacy implementation scan should not run");
  };
  provider.gaugeDocuments = () => {
    throw new Error("legacy reference scan should not run");
  };

  const aliases = await provider.stepImplementationValuesAt(document, { line: 1, character: 4 });
  const references = await provider.localStepReferences(aliases[0], { sourceDocument: document });
  const commandReferences = await provider.localStepReferences(aliases[0], {
    sourcePath: document.uri.fsPath,
  });

  assert.deepEqual(aliases, ["Open cart"]);
  assert.deepEqual(references, [location]);
  assert.deepEqual(commandReferences, [location]);
  assert.deepEqual(calls, [
    { sourceDocument: document, template: "Open cart" },
    { sourcePath: document.uri.fsPath, template: "Open cart" },
  ]);
  assert.deepEqual(offsetPositions, [{ line: 1, character: 4 }]);
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

test("ReferenceProvider skips unopened Step sources resolved to non-Gauge projects", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const { GaugeProject } = require("../src/project/gaugeProject");
  const requestCalls = [];
  const openedFiles = [];
  const outsideUri = {
    fsPath: "/workspace/notes/src/test/kotlin/OtherSteps.kt",
  };
  const activeDocument = {
    languageId: "kotlin",
    uri: {
      fsPath: "/workspace/gauge/src/test/kotlin/Steps.kt",
      toString() {
        return "file:///workspace/gauge/src/test/kotlin/Steps.kt";
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
  const { calls, vscode } = createFakeVscode({
    activeDocument,
    activePosition: { line: 2, character: 8 },
    workspace: {
      async findFiles(pattern) {
        return pattern === "**/*.kt" ? [outsideUri] : [];
      },
      async openTextDocument(uri) {
        openedFiles.push(uri.fsPath);
        return {
          languageId: "kotlin",
          uri,
          getText() {
            return [
              "import com.thoughtworks.gauge.Step",
              "",
              "@Step(\"Other <value>\")",
              "fun other(value: String) {}",
            ].join("\n");
          },
        };
      },
      textDocuments: [activeDocument],
    },
  });
  const clients = new GaugeClients();
  const client = createClient({
    "gauge/stepValueAt": null,
    "gauge/stepReferences": [
      { uri: "file:///workspace/gauge/specs/example.spec", range: { start: { line: 2, character: 0 } } },
    ],
  }, requestCalls);
  clients.set("/workspace/gauge", {
    project: new GaugeProject("/workspace/gauge", { Language: "kotlin", Plugins: [] }),
    client,
  });

  const provider = new ReferenceProvider(clients, {
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        if (filename.startsWith("/workspace/gauge/")) {
          return "/workspace/gauge";
        }
        if (filename.startsWith("/workspace/notes/")) {
          return "/workspace/notes";
        }
        throw new Error("not a Gauge project file");
      },
      isGaugeProject(root) {
        return root === "/workspace/gauge";
      },
    },
    vscode,
  });

  const result = await provider.showStepReferencesAtCursor();

  assert.equal(result, true);
  assert.equal(requestCalls[1].params, "Say hello to <name>");
  assert.equal(calls.commands[0].command, "editor.action.showReferences");
  assert.deepEqual(openedFiles, []);
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
        "  * Say hello to \"alice\"",
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
              start: { line: 3, character: 2 },
              end: { line: 3, character: 24 },
            },
            converted: "location",
          },
        ],
      ],
    },
  ]);
});

test("ReferenceProvider falls back to local references when LSP returns an empty list", async () => {
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
        "  * Say hello to \"alice\"",
      ].join("\n");
    },
  };
  const { calls, vscode } = createFakeVscode({
    activeDocument,
    workspace: {
      async findFiles(pattern) {
        if (pattern === "**/*.spec" || pattern === "**/*.cpt" || pattern === "**/*.md") {
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
  const client = createClient({ "gauge/stepReferences": [] }, requestCalls);
  clients.set("/workspace", {
    project: new GaugeProject("/workspace", { Language: "kotlin", Plugins: [] }),
    client,
  });

  const provider = new ReferenceProvider(clients, { vscode });
  const result = await provider.showStepReferences(
    "file:///workspace/tests/Steps.kt",
    { line: 3, character: 5 },
    "Say hello to <name>",
  );

  assert.equal(result, true);
  assert.deepEqual(requestCalls.map((entry) => entry.method), ["gauge/stepReferences"]);
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
              start: { line: 3, character: 2 },
              end: { line: 3, character: 24 },
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
        "  * Say hello to \"alice\"",
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
        start: { line: 3, character: 2 },
        end: { line: 3, character: 24 },
      },
      converted: "location",
    },
  ]);
});

test("ReferenceProvider excludes closed docstring payloads but keeps unterminated payload steps", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
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
        "@Step(\"Not a Gauge step\")",
        "fun wrong() {}",
      ].join("\n");
    },
  };
  const gaugeDocument = (name, closed) => ({
    languageId: "gauge",
    uri: {
      fsPath: `/workspace/specs/${name}.spec`,
      toString() {
        return `file:///workspace/specs/${name}.spec`;
      },
    },
    getText() {
      return [
        `# ${name}`,
        "## Scenario",
        "* Execute content",
        "\"\"\"",
        "* Not a Gauge step",
        ...(closed ? ["\"\"\""] : []),
      ].join("\n");
    },
  });
  const closedDocument = gaugeDocument("closed", true);
  const unterminatedDocument = gaugeDocument("unterminated", false);
  const conceptDocument = {
    languageId: "gauge-concept",
    uri: {
      fsPath: "/workspace/concepts/closed.cpt",
      toString() {
        return "file:///workspace/concepts/closed.cpt";
      },
    },
    getText() {
      return [
        "# Real concept",
        "* Execute content",
        "\"\"\"",
        "# Not a Gauge step",
        "\"\"\"",
      ].join("\n");
    },
  };
  const { vscode } = createFakeVscode({
    workspace: {
      textDocuments: [activeDocument, closedDocument, unterminatedDocument, conceptDocument],
    },
  });
  const provider = new ReferenceProvider(new GaugeClients(), { vscode });

  const result = await provider.provideReferences(activeDocument, { line: 3, character: 5 });

  assert.deepEqual(plainLocations(result), [{
    uri: "file:///workspace/specs/unterminated.spec",
    range: {
      start: { line: 4, character: 0 },
      end: { line: 4, character: 18 },
    },
  }]);
});

test("ReferenceProvider matches multiline local Gauge references for Kotlin Step aliases", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const originalAllowMultiline = process.env.allow_multiline_step;
  delete process.env.allow_multiline_step;
  const activeDocument = {
    languageId: "kotlin",
    uri: {
      fsPath: "/workspace/gauge/tests/PaymentSteps.kt",
      toString() {
        return "file:///workspace/gauge/tests/PaymentSteps.kt";
      },
    },
    getText() {
      return [
        "import com.thoughtworks.gauge.Step",
        "",
        "@Step(\"Pay with card\")",
        "fun pay() {}",
      ].join("\n");
    },
  };
  const specDocument = {
    languageId: "gauge",
    uri: {
      fsPath: "/workspace/gauge/specs/payment.spec",
      toString() {
        return "file:///workspace/gauge/specs/payment.spec";
      },
    },
    getText() {
      return [
        "# Payment",
        "* Pay with",
        "card",
      ].join("\n");
    },
  };
  const { vscode } = createFakeVscode({
    workspace: {
      textDocuments: [activeDocument, specDocument],
    },
  });
  const provider = new ReferenceProvider(new GaugeClients(), {
    fileSystem: {
      readFileSync(filename, encoding) {
        assert.equal(filename, "/workspace/gauge/env/default/default.properties");
        assert.equal(encoding, "utf8");
        return "allow_multiline_step = true\n";
      },
    },
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        if (filename.startsWith("/workspace/gauge/")) {
          return "/workspace/gauge";
        }
        throw new Error("not a Gauge project file");
      },
      isGaugeProject(root) {
        assert.equal(root, "/workspace/gauge");
        return true;
      },
    },
    vscode,
  });

  try {
    const result = await provider.provideReferences(
      activeDocument,
      { line: 3, character: 5 },
    );

    assert.deepEqual(plainLocations(result), [
      {
        uri: "file:///workspace/gauge/specs/payment.spec",
        range: {
          start: { line: 1, character: 0 },
          end: { line: 2, character: 4 },
        },
      },
    ]);
  } finally {
    if (originalAllowMultiline === undefined) {
      delete process.env.allow_multiline_step;
    } else {
      process.env.allow_multiline_step = originalAllowMultiline;
    }
  }
});

test("ReferenceProvider provides local references for Java Step aliases", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const activeDocument = {
    languageId: "plaintext",
    uri: {
      fsPath: "/workspace/tests/Steps.java",
      toString() {
        return "file:///workspace/tests/Steps.java";
      },
    },
    getText() {
      return [
        "package steps;",
        "",
        "import com.thoughtworks.gauge.Step;",
        "",
        "public class Steps {",
        "  @Step(\"Say hello to <name>\")",
        "  public void say(String name) {",
        "  }",
        "}",
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
    activePosition: { line: 6, character: 16 },
    workspace: {
      textDocuments: [activeDocument, specDocument],
    },
  });
  const provider = new ReferenceProvider(new GaugeClients(), { vscode });

  const result = await provider.provideReferences(
    activeDocument,
    { line: 6, character: 16 },
  );

  assert.deepEqual(plainLocations(result), [
    {
      uri: "file:///workspace/specs/example.spec",
      range: {
        start: { line: 3, character: 0 },
        end: { line: 3, character: 22 },
      },
    },
  ]);
});

test("ReferenceProvider provides local references for every Kotlin Step alias at declarations", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
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
        "@Step(\"Say hello to <name>\", \"Greet <name>\")",
        "fun say(name: String) {}",
      ].join("\n");
    },
  };
  const firstSpecDocument = {
    languageId: "gauge",
    uri: {
      fsPath: "/workspace/specs/hello.spec",
      toString() {
        return "file:///workspace/specs/hello.spec";
      },
    },
    getText() {
      return [
        "# Hello",
        "",
        "## Scenario",
        "* Say hello to \"alice\"",
      ].join("\n");
    },
  };
  const secondSpecDocument = {
    languageId: "gauge",
    uri: {
      fsPath: "/workspace/specs/greet.spec",
      toString() {
        return "file:///workspace/specs/greet.spec";
      },
    },
    getText() {
      return [
        "# Greet",
        "",
        "## Scenario",
        "* Greet \"bob\"",
      ].join("\n");
    },
  };
  const { vscode } = createFakeVscode({
    activeDocument,
    activePosition: { line: 3, character: 5 },
    workspace: {
      textDocuments: [activeDocument, firstSpecDocument, secondSpecDocument],
    },
  });
  const provider = new ReferenceProvider(new GaugeClients(), { vscode });

  const result = await provider.provideReferences(
    activeDocument,
    { line: 3, character: 5 },
  );

  assert.deepEqual(plainLocations(result), [
    {
      uri: "file:///workspace/specs/hello.spec",
      range: {
        start: { line: 3, character: 0 },
        end: { line: 3, character: 22 },
      },
    },
    {
      uri: "file:///workspace/specs/greet.spec",
      range: {
        start: { line: 3, character: 0 },
        end: { line: 3, character: 13 },
      },
    },
  ]);
});

test("ReferenceProvider includes Kotlin super Step aliases for override methods", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const activeDocument = {
    languageId: "kotlin",
    uri: {
      fsPath: "/workspace/tests/LoginSteps.kt",
      toString() {
        return "file:///workspace/tests/LoginSteps.kt";
      },
    },
    getText() {
      return [
        "import com.thoughtworks.gauge.Step",
        "",
        "interface LoginSteps {",
        "  @Step(\"Sign in as <user>\")",
        "  fun login(user: String)",
        "}",
        "",
        "class WebLoginSteps : LoginSteps {",
        "  @Step(\"Log in as <user>\")",
        "  override fun login(user: String) {}",
        "}",
      ].join("\n");
    },
  };
  const firstSpecDocument = {
    languageId: "gauge",
    uri: {
      fsPath: "/workspace/specs/sign-in.spec",
      toString() {
        return "file:///workspace/specs/sign-in.spec";
      },
    },
    getText() {
      return [
        "# Sign in",
        "",
        "## Scenario",
        "* Sign in as \"alice\"",
      ].join("\n");
    },
  };
  const secondSpecDocument = {
    languageId: "gauge",
    uri: {
      fsPath: "/workspace/specs/log-in.spec",
      toString() {
        return "file:///workspace/specs/log-in.spec";
      },
    },
    getText() {
      return [
        "# Log in",
        "",
        "## Scenario",
        "* Log in as \"bob\"",
      ].join("\n");
    },
  };
  const { vscode } = createFakeVscode({
    activeDocument,
    activePosition: { line: 9, character: 19 },
    workspace: {
      textDocuments: [activeDocument, firstSpecDocument, secondSpecDocument],
    },
  });
  const provider = new ReferenceProvider(new GaugeClients(), { vscode });

  const result = await provider.provideReferences(
    activeDocument,
    { line: 9, character: 19 },
  );

  assert.deepEqual(plainLocations(result), [
    {
      uri: "file:///workspace/specs/log-in.spec",
      range: {
        start: { line: 3, character: 0 },
        end: { line: 3, character: 17 },
      },
    },
    {
      uri: "file:///workspace/specs/sign-in.spec",
      range: {
        start: { line: 3, character: 0 },
        end: { line: 3, character: 20 },
      },
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

  assert.deepEqual(plainLocations(result), [
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

test("ReferenceProvider provides local references from multiline Gauge step cursor without LSP", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const originalAllowMultiline = process.env.allow_multiline_step;
  delete process.env.allow_multiline_step;
  const specDocument = {
    languageId: "gauge",
    uri: {
      fsPath: "/workspace/gauge/specs/payment.spec",
      toString() {
        return "file:///workspace/gauge/specs/payment.spec";
      },
    },
    getText() {
      return [
        "# Payment",
        "* Pay with",
        "card",
      ].join("\n");
    },
  };
  const otherSpecDocument = {
    languageId: "gauge",
    uri: {
      fsPath: "/workspace/gauge/specs/other.spec",
      toString() {
        return "file:///workspace/gauge/specs/other.spec";
      },
    },
    getText() {
      return [
        "# Other",
        "* Pay with card",
      ].join("\n");
    },
  };
  const { vscode } = createFakeVscode({
    workspace: {
      textDocuments: [specDocument, otherSpecDocument],
    },
  });
  const provider = new ReferenceProvider(new GaugeClients(), {
    fileSystem: {
      readFileSync(filename, encoding) {
        assert.equal(filename, "/workspace/gauge/env/default/default.properties");
        assert.equal(encoding, "utf8");
        return "allow_multiline_step = true\n";
      },
    },
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        if (filename.startsWith("/workspace/gauge/")) {
          return "/workspace/gauge";
        }
        throw new Error("not a Gauge project file");
      },
      isGaugeProject(root) {
        assert.equal(root, "/workspace/gauge");
        return true;
      },
    },
    vscode,
  });

  try {
    const result = await provider.provideReferences(
      specDocument,
      { line: 2, character: 2 },
    );

    assert.deepEqual(plainLocations(result), [
      {
        uri: "file:///workspace/gauge/specs/payment.spec",
        range: {
          start: { line: 1, character: 0 },
          end: { line: 2, character: 4 },
        },
      },
      {
        uri: "file:///workspace/gauge/specs/other.spec",
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 15 },
        },
      },
    ]);
  } finally {
    if (originalAllowMultiline === undefined) {
      delete process.env.allow_multiline_step;
    } else {
      process.env.allow_multiline_step = originalAllowMultiline;
    }
  }
});

test("ReferenceProvider accepts plaintext .spec documents for local references", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const specDocument = {
    languageId: "plaintext",
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
    languageId: "plaintext",
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

  assert.deepEqual(plainLocations(result), [
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
        "  # Log in as <user>",
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

  assert.deepEqual(plainLocations(result), [
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
        start: { line: 0, character: 4 },
        end: { line: 0, character: 20 },
      },
    },
  ]);
});

test("ReferenceProvider includes gauge-concept headings in local Step references by language id", async () => {
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
  const conceptDocument = {
    languageId: "gauge-concept",
    uri: {
      fsPath: "/workspace/concepts/login",
      toString() {
        return "file:///workspace/concepts/login";
      },
    },
    getText() {
      return [
        "  # Log in as <user>",
        "* Enter username",
      ].join("\n");
    },
  };
  const { vscode } = createFakeVscode({
    workspace: {
      textDocuments: [kotlinDocument, conceptDocument],
    },
  });
  const provider = new ReferenceProvider(new GaugeClients(), { vscode });

  const result = await provider.provideReferences(
    kotlinDocument,
    { line: 3, character: 5 },
  );

  assert.deepEqual(plainLocations(result), [
    {
      uri: "file:///workspace/concepts/login",
      range: {
        start: { line: 0, character: 4 },
        end: { line: 0, character: 20 },
      },
    },
  ]);
});

test("ReferenceProvider provides local references from concept heading cursor without LSP", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const conceptDocument = {
    languageId: "gauge",
    uri: {
      fsPath: "/workspace/specs/concepts/shared.cpt",
      toString() {
        return "file:///workspace/specs/concepts/shared.cpt";
      },
    },
    getText() {
      return [
        "  # Shared checkout <item>",
        "* Prepare cart",
      ].join("\n");
    },
  };
  const specDocument = {
    languageId: "gauge",
    uri: {
      fsPath: "/workspace/specs/checkout.spec",
      toString() {
        return "file:///workspace/specs/checkout.spec";
      },
    },
    getText() {
      return [
        "# Checkout",
        "",
        "## Scenario",
        "* Shared checkout \"book\"",
      ].join("\n");
    },
  };
  const otherConceptDocument = {
    languageId: "gauge",
    uri: {
      fsPath: "/workspace/specs/concepts/reuse.cpt",
      toString() {
        return "file:///workspace/specs/concepts/reuse.cpt";
      },
    },
    getText() {
      return [
        "# Reuse checkout",
        "* Shared checkout \"pen\"",
      ].join("\n");
    },
  };
  const { vscode } = createFakeVscode({
    workspace: {
      async findFiles(pattern) {
        if (pattern === "**/*.spec" || pattern === "**/*.cpt" || pattern === "**/*.md") {
          return [];
        }
        throw new Error(`unexpected findFiles pattern: ${pattern}`);
      },
      async openTextDocument() {
        throw new Error("no unopened files should be opened");
      },
      textDocuments: [conceptDocument, specDocument, otherConceptDocument],
    },
  });
  const provider = new ReferenceProvider(new GaugeClients(), { vscode });

  const references = await provider.provideReferences(
    conceptDocument,
    { line: 0, character: 14 },
  );

  assert.deepEqual(plainLocations(references), [
    {
      uri: "file:///workspace/specs/concepts/shared.cpt",
      range: {
        start: { line: 0, character: 4 },
        end: { line: 0, character: 26 },
      },
    },
    {
      uri: "file:///workspace/specs/checkout.spec",
      range: {
        start: { line: 3, character: 0 },
        end: { line: 3, character: 24 },
      },
    },
    {
      uri: "file:///workspace/specs/concepts/reuse.cpt",
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 23 },
      },
    },
  ]);
});

test("ReferenceProvider provides local references from gauge-concept heading cursor without LSP", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const conceptDocument = {
    languageId: "gauge-concept",
    uri: {
      fsPath: "/workspace/specs/concepts/shared",
      toString() {
        return "file:///workspace/specs/concepts/shared";
      },
    },
    getText() {
      return [
        "  # Shared checkout <item>",
        "* Prepare cart",
      ].join("\n");
    },
  };
  const specDocument = {
    languageId: "gauge",
    uri: {
      fsPath: "/workspace/specs/checkout.spec",
      toString() {
        return "file:///workspace/specs/checkout.spec";
      },
    },
    getText() {
      return [
        "# Checkout",
        "",
        "## Scenario",
        "* Shared checkout \"book\"",
      ].join("\n");
    },
  };
  const otherConceptDocument = {
    languageId: "gauge-concept",
    uri: {
      fsPath: "/workspace/specs/concepts/reuse",
      toString() {
        return "file:///workspace/specs/concepts/reuse";
      },
    },
    getText() {
      return [
        "# Reuse checkout",
        "* Shared checkout \"pen\"",
      ].join("\n");
    },
  };
  const { vscode } = createFakeVscode({
    workspace: {
      async findFiles(pattern) {
        if (pattern === "**/*.spec" || pattern === "**/*.cpt" || pattern === "**/*.md") {
          return [];
        }
        throw new Error(`unexpected findFiles pattern: ${pattern}`);
      },
      async openTextDocument() {
        throw new Error("no unopened files should be opened");
      },
      textDocuments: [conceptDocument, specDocument, otherConceptDocument],
    },
  });
  const provider = new ReferenceProvider(new GaugeClients(), { vscode });

  const references = await provider.provideReferences(
    conceptDocument,
    { line: 0, character: 14 },
  );

  assert.deepEqual(plainLocations(references), [
    {
      uri: "file:///workspace/specs/concepts/shared",
      range: {
        start: { line: 0, character: 4 },
        end: { line: 0, character: 26 },
      },
    },
    {
      uri: "file:///workspace/specs/checkout.spec",
      range: {
        start: { line: 3, character: 0 },
        end: { line: 3, character: 24 },
      },
    },
    {
      uri: "file:///workspace/specs/concepts/reuse",
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 23 },
      },
    },
  ]);
});

test("ReferenceProvider accepts plaintext .cpt concept headings for local references", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const conceptDocument = {
    languageId: "plaintext",
    uri: {
      fsPath: "/workspace/specs/concepts/shared.cpt",
      toString() {
        return "file:///workspace/specs/concepts/shared.cpt";
      },
    },
    getText() {
      return [
        "# Shared checkout <item>",
        "* Prepare cart",
      ].join("\n");
    },
  };
  const specDocument = {
    languageId: "plaintext",
    uri: {
      fsPath: "/workspace/specs/checkout.spec",
      toString() {
        return "file:///workspace/specs/checkout.spec";
      },
    },
    getText() {
      return [
        "# Checkout",
        "",
        "## Scenario",
        "* Shared checkout \"book\"",
      ].join("\n");
    },
  };
  const { vscode } = createFakeVscode({
    workspace: {
      textDocuments: [conceptDocument, specDocument],
    },
  });
  const provider = new ReferenceProvider(new GaugeClients(), { vscode });

  const references = await provider.provideReferences(
    conceptDocument,
    { line: 0, character: 12 },
  );

  assert.deepEqual(plainLocations(references), [
    {
      uri: "file:///workspace/specs/concepts/shared.cpt",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 24 },
      },
    },
    {
      uri: "file:///workspace/specs/checkout.spec",
      range: {
        start: { line: 3, character: 0 },
        end: { line: 3, character: 24 },
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

test("ReferenceProvider keeps table Gauge references without closing pipes", async () => {
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
        "fun compare(table: Any) {}",
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
        "# Compare",
        "",
        "## Scenario",
        "* Compare",
        "  | name",
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
    languageId: "markdown",
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

test("ReferenceProvider provides local references from Markdown Gauge spec steps", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const markdownDocument = {
    languageId: "markdown",
    uri: {
      fsPath: "/workspace/specs/example.md",
      toString() {
        return "file:///workspace/specs/example.md";
      },
    },
    getText() {
      return [
        "# Example",
        "",
        "* Say hello to \"bob\"",
      ].join("\n");
    },
  };
  const { vscode } = createFakeVscode({
    activeDocument: markdownDocument,
    activePosition: { line: 2, character: 5 },
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
      textDocuments: [markdownDocument],
    },
  });
  const provider = new ReferenceProvider(new GaugeClients(), { vscode });

  const references = await provider.provideReferences(markdownDocument, { line: 2, character: 5 });

  assert.equal(references.length, 1);
  const [reference] = references;
  assert.ok(reference instanceof vscode.Location);
  assert.equal(reference.uri.fsPath, "/workspace/specs/example.md");
  assert.equal(reference.uri.uri, "file:///workspace/specs/example.md");
  assert.ok(reference.range instanceof vscode.Range);
  assert.ok(reference.range.start instanceof vscode.Position);
  assert.deepEqual(
    [reference.range.start.line, reference.range.start.character],
    [2, 0],
  );
  assert.deepEqual(
    [reference.range.end.line, reference.range.end.character],
    [2, 20],
  );
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

test("ReferenceProvider ignores retained command handlers after disposal", async () => {
  const { ReferenceProvider } = require("../src/gaugeReference");
  const handlers = new Map();
  const disposeCalls = new Map();
  let clientLookups = 0;
  let requestCalls = 0;
  const { calls, vscode } = createFakeVscode();
  vscode.commands.registerCommand = (command, handler) => {
    handlers.set(command, handler);
    return {
      dispose() {
        disposeCalls.set(command, (disposeCalls.get(command) || 0) + 1);
      },
    };
  };
  vscode.languages = {
    registerReferenceProvider(_selector, _provider) {
      return {
        dispose() {
          disposeCalls.set("referenceProvider", (disposeCalls.get("referenceProvider") || 0) + 1);
        },
      };
    },
  };
  const clients = {
    get() {
      clientLookups += 1;
      return {
        client: {
          sendRequest(method) {
            requestCalls += 1;
            return Promise.resolve(method === "gauge/stepValueAt" ? "Say hello" : []);
          },
        },
      };
    },
  };
  const provider = new ReferenceProvider(clients, { vscode });
  const atCursor = handlers.get("gauge.showReferences.atCursor");
  const forStep = handlers.get("gauge.showReferences");

  provider.dispose();
  provider.dispose();
  const outcomes = await Promise.allSettled([
    atCursor(),
    forStep("file:///workspace/specs/example.spec", { line: 1, character: 0 }, "Say hello"),
    provider.showStepReferences(
      "file:///workspace/specs/example.spec",
      { line: 1, character: 0 },
      "Say hello",
    ),
  ]);

  assert.deepEqual(outcomes, [
    { status: "fulfilled", value: undefined },
    { status: "fulfilled", value: undefined },
    { status: "fulfilled", value: undefined },
  ]);
  assert.deepEqual(Object.fromEntries(disposeCalls), {
    "gauge.showReferences.atCursor": 1,
    "gauge.showReferences": 1,
    referenceProvider: 1,
  });
  assert.equal(clientLookups, 0);
  assert.equal(requestCalls, 0);
  assert.deepEqual(calls.commands, []);
  assert.deepEqual(calls.information, []);
});

test("ReferenceProvider cancels pending direct reference requests on disposal", async () => {
  const { ReferenceProvider } = require("../src/gaugeReference");
  const lateError = new Error("late reference request failed");
  for (const scenario of [
    { stepValue: "Say hello", settlement: "resolve" },
    { stepValue: "# Shared concept", settlement: "reject" },
  ]) {
    const requestGate = deferred();
    const requestCalls = [];
    const sources = [];
    const { calls, vscode } = createFakeVscode();
    trackCancellationSources(vscode, sources);
    const client = {
      sendRequest(method, params, token) {
        requestCalls.push({ method, params, token });
        return requestGate.promise;
      },
    };
    const provider = new ReferenceProvider({ get: () => ({ client }) }, { vscode });
    let outcome;
    const invocation = provider.showStepReferences(
      "file:///workspace/specs/example.spec",
      { line: 2, character: 0 },
      scenario.stepValue,
    );
    invocation.then(
      (value) => {
        outcome = { status: "fulfilled", value };
      },
      (reason) => {
        outcome = { status: "rejected", reason };
      },
    );

    let observedBeforeRelease;
    try {
      provider.dispose();
      await nextTurn();
      observedBeforeRelease = outcome;
    } finally {
      if (scenario.settlement === "resolve") {
        requestGate.resolve([
          { uri: "file:///workspace/specs/example.spec", range: { start: { line: 4, character: 0 } } },
        ]);
      } else {
        requestGate.reject(lateError);
      }
      await Promise.allSettled([invocation]);
    }

    assert.deepEqual(observedBeforeRelease, { status: "fulfilled", value: undefined });
    assert.deepEqual(requestCalls.map((entry) => entry.method), ["gauge/stepReferences"]);
    assert.equal(sources.length, 1);
    assert.equal(requestCalls[0].token, sources[0].token);
    assert.equal(sources[0].cancelCalls, 1);
    assert.equal(sources[0].disposeCalls, 1);
    assert.equal(sources[0].token.isCancellationRequested, true);
    assert.equal(provider.activeOperations.size, 0);
    assert.deepEqual(calls.commands, []);
    assert.deepEqual(calls.information, []);
  }
});

test("ReferenceProvider stops cursor reference lookup when disposed during step lookup", async () => {
  const { ReferenceProvider } = require("../src/gaugeReference");
  const requestGate = deferred();
  const requestCalls = [];
  const sources = [];
  const { calls, vscode } = createFakeVscode();
  trackCancellationSources(vscode, sources);
  const client = {
    sendRequest(method, params, token) {
      requestCalls.push({ method, params, token });
      return requestGate.promise;
    },
  };
  const provider = new ReferenceProvider({ get: () => ({ client }) }, { vscode });
  let outcome;
  const invocation = provider.showStepReferencesAtCursor();
  invocation.then(
    (value) => {
      outcome = { status: "fulfilled", value };
    },
    (reason) => {
      outcome = { status: "rejected", reason };
    },
  );

  let observedBeforeRelease;
  try {
    provider.dispose();
    await nextTurn();
    observedBeforeRelease = outcome;
  } finally {
    requestGate.resolve("Say hello");
    await Promise.allSettled([invocation]);
  }

  assert.deepEqual(observedBeforeRelease, { status: "fulfilled", value: undefined });
  assert.deepEqual(requestCalls.map((entry) => entry.method), ["gauge/stepValueAt"]);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].cancelCalls, 1);
  assert.equal(sources[0].disposeCalls, 1);
  assert.equal(provider.activeOperations.size, 0);
  assert.deepEqual(calls.commands, []);
  assert.deepEqual(calls.information, []);
});

test("ReferenceProvider stops cursor reference lookup when disposed during reference lookup", async () => {
  const { ReferenceProvider } = require("../src/gaugeReference");
  const referenceEntered = deferred();
  const referenceGate = deferred();
  const requestCalls = [];
  const sources = [];
  const { calls, vscode } = createFakeVscode();
  trackCancellationSources(vscode, sources);
  const client = {
    sendRequest(method, params, token) {
      requestCalls.push({ method, params, token });
      if (method === "gauge/stepValueAt") {
        return Promise.resolve("Say hello");
      }
      referenceEntered.resolve();
      return referenceGate.promise;
    },
  };
  const provider = new ReferenceProvider({ get: () => ({ client }) }, { vscode });
  let outcome;
  const invocation = provider.showStepReferencesAtCursor();
  invocation.then(
    (value) => {
      outcome = { status: "fulfilled", value };
    },
    (reason) => {
      outcome = { status: "rejected", reason };
    },
  );
  await referenceEntered.promise;

  let observedBeforeRelease;
  try {
    provider.dispose();
    await nextTurn();
    observedBeforeRelease = outcome;
  } finally {
    referenceGate.resolve([
      { uri: "file:///workspace/specs/example.spec", range: { start: { line: 4, character: 0 } } },
    ]);
    await Promise.allSettled([invocation]);
  }

  assert.deepEqual(observedBeforeRelease, { status: "fulfilled", value: undefined });
  assert.deepEqual(requestCalls.map((entry) => entry.method), [
    "gauge/stepValueAt",
    "gauge/stepReferences",
  ]);
  assert.equal(sources.length, 2);
  assert.deepEqual(sources.map((source) => source.cancelCalls), [0, 1]);
  assert.deepEqual(sources.map((source) => source.disposeCalls), [1, 1]);
  assert.equal(provider.activeOperations.size, 0);
  assert.deepEqual(calls.commands, []);
  assert.deepEqual(calls.information, []);
});

test("ReferenceProvider stops pending local reference fallback on disposal", async () => {
  const { ReferenceProvider } = require("../src/gaugeReference");
  const fallbackEntered = deferred();
  const fallbackGate = deferred();
  const sources = [];
  const { calls, vscode } = createFakeVscode();
  trackCancellationSources(vscode, sources);
  const client = {
    sendRequest() {
      return Promise.resolve([]);
    },
  };
  const provider = new ReferenceProvider({ get: () => ({ client }) }, {
    vscode,
    workspaceStepIndex: {
      referenceLocationsForPath() {
        fallbackEntered.resolve();
        return fallbackGate.promise;
      },
    },
  });
  let outcome;
  const invocation = provider.showStepReferences(
    "file:///workspace/specs/example.spec",
    { line: 2, character: 0 },
    "Say hello",
  );
  invocation.then(
    (value) => {
      outcome = { status: "fulfilled", value };
    },
    (reason) => {
      outcome = { status: "rejected", reason };
    },
  );
  await fallbackEntered.promise;

  let observedBeforeRelease;
  try {
    provider.dispose();
    await nextTurn();
    observedBeforeRelease = outcome;
  } finally {
    fallbackGate.resolve([
      { uri: "file:///workspace/specs/example.spec", range: { start: { line: 4, character: 0 } } },
    ]);
    await Promise.allSettled([invocation]);
  }

  assert.deepEqual(observedBeforeRelease, { status: "fulfilled", value: undefined });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].cancelCalls, 0);
  assert.equal(sources[0].disposeCalls, 1);
  assert.equal(provider.activeOperations.size, 0);
  assert.deepEqual(calls.commands, []);
  assert.deepEqual(calls.information, []);
});

test("ReferenceProvider detaches a started references UI command on disposal", async () => {
  const { ReferenceProvider } = require("../src/gaugeReference");
  const commandEntered = deferred();
  const commandGate = deferred();
  const sources = [];
  const { calls, vscode } = createFakeVscode();
  trackCancellationSources(vscode, sources);
  vscode.commands.executeCommand = (command, ...args) => {
    calls.commands.push({ command, args });
    commandEntered.resolve();
    return commandGate.promise;
  };
  const location = {
    uri: "file:///workspace/specs/example.spec",
    range: { start: { line: 4, character: 0 } },
  };
  const client = {
    sendRequest() {
      return Promise.resolve([location]);
    },
    protocol2CodeConverter: {
      asPosition(position) {
        return position;
      },
      asLocation(value) {
        return value;
      },
    },
  };
  const provider = new ReferenceProvider({ get: () => ({ client }) }, { vscode });
  let outcome;
  const invocation = provider.showStepReferences(
    "file:///workspace/specs/example.spec",
    { line: 2, character: 0 },
    "Say hello",
  );
  invocation.then(
    (value) => {
      outcome = { status: "fulfilled", value };
    },
    (reason) => {
      outcome = { status: "rejected", reason };
    },
  );
  await commandEntered.promise;

  let observedBeforeRelease;
  try {
    provider.dispose();
    await nextTurn();
    observedBeforeRelease = outcome;
  } finally {
    commandGate.reject(new Error("late references UI failed"));
    await Promise.allSettled([invocation]);
  }

  assert.deepEqual(observedBeforeRelease, { status: "fulfilled", value: undefined });
  assert.equal(calls.commands.length, 1);
  assert.equal(calls.commands[0].command, "editor.action.showReferences");
  assert.equal(sources.length, 1);
  assert.equal(sources[0].cancelCalls, 0);
  assert.equal(sources[0].disposeCalls, 1);
  assert.equal(provider.activeOperations.size, 0);
  assert.deepEqual(calls.information, []);
});

test("ReferenceProvider preserves live command failures and releases request sources", async () => {
  const { ReferenceProvider } = require("../src/gaugeReference");
  const requestError = new Error("live reference request failed");
  const commandError = new Error("live references UI failed");
  for (const scenario of [
    { expected: { status: "fulfilled", value: true }, name: "success" },
    { expected: { status: "rejected", reason: requestError }, name: "request" },
    { expected: { status: "rejected", reason: commandError }, name: "command" },
  ]) {
    const sources = [];
    const { calls, vscode } = createFakeVscode();
    trackCancellationSources(vscode, sources);
    vscode.commands.executeCommand = (command, ...args) => {
      calls.commands.push({ command, args });
      return scenario.name === "command" ? Promise.reject(commandError) : Promise.resolve(true);
    };
    const location = {
      uri: "file:///workspace/specs/example.spec",
      range: { start: { line: 4, character: 0 } },
    };
    const client = {
      sendRequest() {
        return scenario.name === "request"
          ? Promise.reject(requestError)
          : Promise.resolve([location]);
      },
      protocol2CodeConverter: {
        asPosition(position) {
          return position;
        },
        asLocation(value) {
          return value;
        },
      },
    };
    const provider = new ReferenceProvider({ get: () => ({ client }) }, { vscode });

    const outcome = await Promise.allSettled([
      provider.showStepReferences(
        "file:///workspace/specs/example.spec",
        { line: 2, character: 0 },
        "Say hello",
      ),
    ]);

    assert.deepEqual(outcome, [scenario.expected]);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].cancelCalls, 0);
    assert.equal(sources[0].disposeCalls, 1);
    assert.equal(provider.activeOperations.size, 0);
    assert.equal(calls.commands.length, scenario.name === "request" ? 0 : 1);
    assert.deepEqual(calls.information, []);
  }
});

test("ReferenceProvider normalizes synchronous disposal at command boundaries", async () => {
  const { ReferenceProvider } = require("../src/gaugeReference");
  const lateError = new Error("synchronous disposal boundary failed");
  for (const boundary of ["source", "request", "converter", "information"]) {
    const sources = [];
    const { calls, vscode } = createFakeVscode();
    let provider;
    let requestCalls = 0;
    let locationConverterCalls = 0;
    trackCancellationSources(
      vscode,
      sources,
      boundary === "source" ? () => provider.dispose() : undefined,
    );
    const location = {
      uri: "file:///workspace/specs/example.spec",
      range: { start: { line: 4, character: 0 } },
    };
    const client = {
      sendRequest() {
        requestCalls += 1;
        if (boundary === "request") {
          provider.dispose();
          return Promise.reject(lateError);
        }
        if (boundary === "information") {
          return Promise.resolve(undefined);
        }
        return Promise.resolve([location]);
      },
      protocol2CodeConverter: {
        asPosition(position) {
          if (boundary === "converter") {
            provider.dispose();
          }
          return position;
        },
        asLocation(value) {
          locationConverterCalls += 1;
          return value;
        },
      },
    };
    if (boundary === "information") {
      vscode.window.showInformationMessage = (message) => {
        calls.information.push(message);
        provider.dispose();
        return Promise.reject(lateError);
      };
    }
    provider = new ReferenceProvider({ get: () => ({ client }) }, { vscode });

    const outcome = await Promise.allSettled([
      provider.showStepReferences(
        "file:///workspace/specs/example.spec",
        { line: 2, character: 0 },
        "Say hello",
      ),
    ]);
    await nextTurn();

    assert.deepEqual(outcome, [{ status: "fulfilled", value: undefined }]);
    assert.equal(provider.activeOperations.size, 0);
    assert.equal(requestCalls, boundary === "source" ? 0 : 1);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].cancelCalls, boundary === "source" || boundary === "request" ? 1 : 0);
    assert.equal(sources[0].disposeCalls, 1);
    assert.equal(locationConverterCalls, 0);
    assert.deepEqual(calls.commands, []);
    assert.equal(calls.information.length, boundary === "information" ? 1 : 0);
  }
});

test("ReferenceProvider cancels concurrent reference commands exactly once", async () => {
  const { ReferenceProvider } = require("../src/gaugeReference");
  const gates = [deferred(), deferred()];
  const sources = [];
  const { calls, vscode } = createFakeVscode();
  trackCancellationSources(vscode, sources);
  let requestIndex = 0;
  const client = {
    sendRequest() {
      const gate = gates[requestIndex];
      requestIndex += 1;
      return gate.promise;
    },
  };
  const provider = new ReferenceProvider({ get: () => ({ client }) }, { vscode });
  const invocations = [
    provider.showStepReferences(
      "file:///workspace/specs/first.spec",
      { line: 2, character: 0 },
      "First step",
    ),
    provider.showStepReferences(
      "file:///workspace/specs/second.spec",
      { line: 3, character: 0 },
      "Second step",
    ),
  ];
  const outcomes = [];
  for (const invocation of invocations) {
    invocation.then(
      (value) => outcomes.push({ status: "fulfilled", value }),
      (reason) => outcomes.push({ status: "rejected", reason }),
    );
  }

  let observedBeforeRelease;
  try {
    assert.equal(provider.activeOperations.size, 2);
    provider.dispose();
    provider.dispose();
    await nextTurn();
    observedBeforeRelease = [...outcomes];
  } finally {
    gates[0].resolve([]);
    gates[1].reject(new Error("late concurrent reference request failed"));
    await Promise.allSettled(invocations);
  }

  assert.deepEqual(observedBeforeRelease, [
    { status: "fulfilled", value: undefined },
    { status: "fulfilled", value: undefined },
  ]);
  assert.equal(provider.activeOperations.size, 0);
  assert.equal(sources.length, 2);
  assert.deepEqual(sources.map((source) => source.cancelCalls), [1, 1]);
  assert.deepEqual(sources.map((source) => source.disposeCalls), [1, 1]);
  assert.deepEqual(calls.commands, []);
  assert.deepEqual(calls.information, []);
});

test("ReferenceProvider stops local scan backends after disposal", async () => {
  const { ReferenceProvider } = require("../src/gaugeReference");
  const lateError = new Error("late local reference scan failed");
  for (const boundary of ["ready", "find", "open"]) {
    for (const settlement of ["resolve", "reject"]) {
      const gate = deferred();
      const boundaryEntered = deferred();
      let documentReads = 0;
      let findCalls = 0;
      let openCalls = 0;
      const { calls, vscode } = createFakeVscode({
        workspace: boundary === "ready" ? {} : {
          findFiles() {
            findCalls += 1;
            if (boundary === "find") {
              boundaryEntered.resolve();
              return gate.promise;
            }
            return Promise.resolve(findCalls === 1
              ? [{ fsPath: "/workspace/specs/example.spec" }]
              : []);
          },
          openTextDocument() {
            openCalls += 1;
            boundaryEntered.resolve();
            return gate.promise;
          },
          textDocuments: [],
        },
      });
      const documentStore = boundary === "ready" ? {
        documents() {
          documentReads += 1;
          return [];
        },
        whenReady() {
          boundaryEntered.resolve();
          return gate.promise;
        },
      } : undefined;
      const provider = new ReferenceProvider({ get: () => undefined }, {
        documentStore,
        vscode,
      });
      let outcome;
      const invocation = provider.showStepReferences(
        "file:///workspace/specs/example.spec",
        { line: 2, character: 0 },
        "Say hello",
      );
      invocation.then(
        (value) => {
          outcome = { status: "fulfilled", value };
        },
        (reason) => {
          outcome = { status: "rejected", reason };
        },
      );
      await boundaryEntered.promise;

      let observedBeforeRelease;
      try {
        provider.dispose();
        await nextTurn();
        observedBeforeRelease = outcome;
      } finally {
        if (settlement === "reject") {
          gate.reject(lateError);
        } else if (boundary === "find") {
          gate.resolve([{ fsPath: "/workspace/specs/example.spec" }]);
        } else {
          gate.resolve({
            languageId: "gauge",
            uri: { fsPath: "/workspace/specs/example.spec" },
            getText() {
              return "* Say hello";
            },
          });
        }
        await Promise.allSettled([invocation]);
      }

      assert.deepEqual(observedBeforeRelease, { status: "fulfilled", value: undefined });
      assert.equal(provider.activeOperations.size, 0);
      assert.equal(documentReads, 0);
      assert.equal(findCalls, boundary === "ready" ? 0 : 1);
      assert.equal(openCalls, boundary === "open" ? 1 : 0);
      assert.deepEqual(calls.commands, []);
      assert.deepEqual(calls.information, []);
    }
  }
});

test("ReferenceProvider closes registrations after synchronous registration disposal", async () => {
  const { ReferenceProvider } = require("../src/gaugeReference");
  const handlers = new Map();
  const disposeCalls = new Map();
  let clientLookups = 0;
  const { calls, vscode } = createFakeVscode();
  vscode.commands.registerCommand = (command, handler) => {
    handlers.set(command, handler);
    return {
      dispose() {
        disposeCalls.set(command, (disposeCalls.get(command) || 0) + 1);
      },
    };
  };
  vscode.languages = {
    registerReferenceProvider(_selector, registeredProvider) {
      registeredProvider.dispose();
      return {
        dispose() {
          disposeCalls.set("referenceProvider", (disposeCalls.get("referenceProvider") || 0) + 1);
        },
      };
    },
  };
  const provider = new ReferenceProvider({
    get() {
      clientLookups += 1;
      return undefined;
    },
  }, { vscode });

  provider.dispose();
  const outcomes = await Promise.allSettled([
    handlers.get("gauge.showReferences.atCursor")(),
    handlers.get("gauge.showReferences")(
      "file:///workspace/specs/example.spec",
      { line: 2, character: 0 },
      "Say hello",
    ),
  ]);

  assert.deepEqual(outcomes, [
    { status: "fulfilled", value: undefined },
    { status: "fulfilled", value: undefined },
  ]);
  assert.deepEqual(Object.fromEntries(disposeCalls), {
    "gauge.showReferences.atCursor": 1,
    "gauge.showReferences": 1,
    referenceProvider: 1,
  });
  assert.equal(clientLookups, 0);
  assert.deepEqual(calls.commands, []);
  assert.deepEqual(calls.information, []);
});

test("ReferenceProvider registers explicit spec and concept reference selectors", () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const referenceProviders = [];
  const { vscode } = createFakeVscode();
  vscode.languages = {
    registerReferenceProvider(selector, provider) {
      referenceProviders.push({ selector, provider });
      return { dispose() {} };
    },
  };

  const provider = new ReferenceProvider(new GaugeClients(), { vscode });

  assert.equal(referenceProviders[0].provider, provider);
  assert.deepEqual(referenceProviders[0].selector, [
    { language: "gauge" },
    { language: "gauge-concept" },
    { scheme: "file", pattern: "**/*.spec" },
    { scheme: "file", pattern: "**/*.cpt" },
    { language: "markdown", scheme: "file", pattern: "**/*.md" },
    { language: "kotlin" },
    { scheme: "file", pattern: "**/*.kt" },
    { language: "java" },
    { scheme: "file", pattern: "**/*.java" },
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

test("ReferenceProvider ignores local Gauge references from another Gauge project", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const implementationDocument = {
    languageId: "kotlin",
    uri: {
      fsPath: "/workspace/project-a/src/test/kotlin/Steps.kt",
      toString() {
        return "file:///workspace/project-a/src/test/kotlin/Steps.kt";
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
  const projectASpec = {
    languageId: "gauge",
    uri: {
      fsPath: "/workspace/project-a/specs/example.spec",
      toString() {
        return "file:///workspace/project-a/specs/example.spec";
      },
    },
    getText() {
      return [
        "# Greeting",
        "",
        "* Say hello to <name>",
      ].join("\n");
    },
  };
  const projectBSpec = {
    languageId: "gauge",
    uri: {
      fsPath: "/workspace/project-b/specs/example.spec",
      toString() {
        return "file:///workspace/project-b/specs/example.spec";
      },
    },
    getText() {
      return [
        "# Greeting",
        "",
        "* Say hello to <name>",
      ].join("\n");
    },
  };
  const projectBConcept = {
    languageId: "gauge",
    uri: {
      fsPath: "/workspace/project-b/specs/concepts/greeting.cpt",
      toString() {
        return "file:///workspace/project-b/specs/concepts/greeting.cpt";
      },
    },
    getText() {
      return [
        "# Say hello to <name>",
        "* Use greeting",
      ].join("\n");
    },
  };
  const { vscode } = createFakeVscode({
    workspace: {
      textDocuments: [
        implementationDocument,
        projectASpec,
        projectBSpec,
        projectBConcept,
      ],
    },
  });
  const provider = new ReferenceProvider(new GaugeClients(), {
    projectFactory: createMultiProjectFactory(),
    vscode,
  });

  const references = await provider.provideReferences(
    implementationDocument,
    { line: 3, character: 5 },
  );

  assert.deepEqual(plainLocations(references), [
    {
      uri: "file:///workspace/project-a/specs/example.spec",
      range: {
        start: { line: 2, character: 0 },
        end: { line: 2, character: 21 },
      },
    },
  ]);
});

test("ReferenceProvider uses the shared document store without workspace scans", async () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const { GaugeProject } = require("../src/project/gaugeProject");
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
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
  const specText = [
    "# Example",
    "",
    "## Scenario",
    "  * Say hello to \"alice\"",
  ].join("\n");
  const specUri = { fsPath: "/workspace/specs/example.spec" };
  const findFilesPatterns = [];
  const openedFiles = [];
  const { vscode } = createFakeVscode({
    activeDocument,
    activePosition: { line: 3, character: 5 },
    workspace: {
      async findFiles(pattern) {
        findFilesPatterns.push(pattern);
        return [specUri];
      },
      async openTextDocument(uri) {
        openedFiles.push(uri.fsPath);
        return {
          languageId: "gauge",
          uri: {
            fsPath: uri.fsPath,
            toString() {
              return `file://${uri.fsPath}`;
            },
          },
          getText() {
            return specText;
          },
        };
      },
      textDocuments: [activeDocument],
    },
  });
  const fileSystem = {
    promises: {
      async readFile(file) {
        assert.equal(file, specUri.fsPath);
        return specText;
      },
    },
  };
  const documentStore = new WorkspaceDocumentStore({ fileSystem, vscode });
  const clients = new GaugeClients();
  const client = createClient({
    "gauge/stepReferences": null,
  }, requestCalls);
  clients.set("/workspace", {
    project: new GaugeProject("/workspace", { Language: "kotlin", Plugins: [] }),
    client,
  });

  const provider = new ReferenceProvider(clients, { documentStore, vscode });
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
        start: { line: 3, character: 2 },
        end: { line: 3, character: 24 },
      },
      converted: "location",
    },
  ]);
  assert.ok(
    findFilesPatterns.length <= 1,
    `expected at most one findFiles call (store scan), got: ${JSON.stringify(findFilesPatterns)}`,
  );
  assert.deepEqual(openedFiles, []);
});
