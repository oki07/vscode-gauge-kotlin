const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

function createFakeVscode(overrides = {}) {
  const commands = [];
  const errors = [];
  const information = [];
  const quickPicks = [];
  const vscode = {
    CancellationTokenSource: class CancellationTokenSource {
      constructor() {
        this.token = { cancelled: false };
      }
    },
    commands: {
      registerCommand(command, handler) {
        commands.push({ command, handler });
        return { dispose() {} };
      },
    },
    env: {
      clipboard: {
        writeText(text) {
          if (overrides.writeClipboard) {
            return overrides.writeClipboard(text);
          }
          return Promise.resolve(text);
        },
      },
    },
    window: {
      activeTextEditor: {
        document: {
          uri: {
            fsPath: "/workspace/specs/example.spec",
          },
        },
      },
      showErrorMessage(message) {
        errors.push(message);
        return Promise.resolve(undefined);
      },
      showInformationMessage(message) {
        information.push(message);
        return Promise.resolve(undefined);
      },
      showQuickPick(items) {
        quickPicks.push(items);
        return Promise.resolve(overrides.quickPickSelection || items[2]);
      },
    },
  };
  return {
    commands,
    errors,
    information,
    quickPicks,
    vscode,
  };
}

test("GenerateStubCommandProvider writes a selected step stub through Gauge LSP", async () => {
  const { GenerateStubCommandProvider } = require("../src/annotator/generateStub");
  const requests = [];
  const appliedEdits = [];
  const { commands, quickPicks, vscode } = createFakeVscode();
  const project = {
    root() {
      return "/workspace";
    },
  };
  const client = {
    protocol2CodeConverter: {
      asWorkspaceEdit(edit) {
        return Promise.resolve({ converted: edit });
      },
    },
    sendRequest(method, params) {
      requests.push({ method, params });
      if (method === "gauge/getImplFiles") {
        return Promise.resolve(["/workspace/src/test/kotlin/Steps.kt"]);
      }
      if (method === "gauge/putStubImpl") {
        return Promise.resolve({ changes: [] });
      }
      throw new Error(`Unexpected ${method}`);
    },
  };
  const clients = {
    get(fsPath) {
      assert.equal(fsPath, "/workspace/specs/example.spec");
      return { project, client };
    },
  };

  new GenerateStubCommandProvider(clients, {
    pathModule: path.posix,
    vscode,
    workspaceEditorFactory(edit) {
      return {
        applyChanges() {
          appliedEdits.push(edit);
          return Promise.resolve(undefined);
        },
      };
    },
  });

  const command = commands.find((entry) => entry.command === "gauge.generate.step");
  await command.handler("fun step() {}");

  assert.deepEqual(quickPicks[0], [
    { label: "New File", description: "Create a new file", value: "New File" },
    { label: "Copy To Clipboard", description: "", value: "Copy To Clipboard" },
    { label: "Steps.kt", description: "src/test/kotlin", value: "/workspace/src/test/kotlin/Steps.kt" },
  ]);
  assert.equal(requests[0].method, "gauge/getImplFiles");
  assert.deepEqual(requests[1], {
    method: "gauge/putStubImpl",
    params: {
      implementationFilePath: "/workspace/src/test/kotlin/Steps.kt",
      codes: ["fun step() {}"],
    },
  });
  assert.deepEqual(appliedEdits, [{ converted: { changes: [] } }]);
});

test("GenerateStubCommandProvider reports clipboard copy failures", async () => {
  const { GenerateStubCommandProvider } = require("../src/annotator/generateStub");
  const { commands, errors, vscode } = createFakeVscode({
    quickPickSelection: {
      label: "Copy To Clipboard",
      description: "",
      value: "Copy To Clipboard",
    },
    writeClipboard() {
      return Promise.reject(new Error("Clipboard unavailable"));
    },
  });
  const project = {
    root() {
      return "/workspace";
    },
  };
  const client = {
    sendRequest(method) {
      assert.equal(method, "gauge/getImplFiles");
      return Promise.resolve(["/workspace/src/test/kotlin/Steps.kt"]);
    },
  };
  const clients = {
    get() {
      return { project, client };
    },
  };

  new GenerateStubCommandProvider(clients, {
    pathModule: path.posix,
    vscode,
  });

  const command = commands.find((entry) => entry.command === "gauge.generate.step");

  await assert.doesNotReject(() => command.handler("fun step() {}"));
  assert.deepEqual(errors, [
    "Unable to generate implementation. Error: Clipboard unavailable",
  ]);
});

test("GenerateStubCommandProvider writes a selected concept through Gauge LSP", async () => {
  const { GenerateStubCommandProvider } = require("../src/annotator/generateStub");
  const requests = [];
  const appliedEdits = [];
  const { commands, quickPicks, vscode } = createFakeVscode({
    quickPickSelection: {
      label: "concepts.cpt",
      description: "specs",
      value: "/workspace/specs/concepts.cpt",
    },
  });
  const project = {
    root() {
      return "/workspace";
    },
  };
  const client = {
    protocol2CodeConverter: {
      asWorkspaceEdit(edit) {
        return Promise.resolve({ converted: edit });
      },
    },
    sendRequest(method, params) {
      requests.push({ method, params });
      if (method === "gauge/getImplFiles") {
        return Promise.resolve(["/workspace/specs/concepts.cpt"]);
      }
      if (method === "gauge/generateConcept") {
        return Promise.resolve({ changes: [] });
      }
      throw new Error(`Unexpected ${method}`);
    },
  };
  const clients = {
    get(fsPath) {
      assert.equal(fsPath, "/workspace/specs/example.spec");
      return { project, client };
    },
  };

  new GenerateStubCommandProvider(clients, {
    pathModule: path.posix,
    vscode,
    workspaceEditorFactory(edit) {
      return {
        applyChanges() {
          appliedEdits.push(edit);
          return Promise.resolve(undefined);
        },
      };
    },
  });

  const command = commands.find((entry) => entry.command === "gauge.generate.concept");
  await command.handler({ conceptName: "# Checkout <arg0>\n* " });

  assert.deepEqual(quickPicks[0], [
    { label: "New File", description: "Create a new file", value: "New File" },
    { label: "concepts.cpt", description: "specs", value: "/workspace/specs/concepts.cpt" },
  ]);
  assert.deepEqual(requests, [
    {
      method: "gauge/getImplFiles",
      params: { concept: true },
    },
    {
      method: "gauge/generateConcept",
      params: {
        conceptName: "# Checkout <arg0>\n* ",
        conceptFile: "/workspace/specs/concepts.cpt",
        dir: "/workspace/specs",
      },
    },
  ]);
  assert.deepEqual(appliedEdits, [{ converted: { changes: [] } }]);
});
