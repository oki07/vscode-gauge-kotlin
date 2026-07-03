const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

function createFakeVscode(overrides = {}) {
  const commands = [];
  const appliedEdits = [];
  const errors = [];
  const information = [];
  const inputBoxes = [];
  const openedDocuments = [];
  const quickPicks = [];
  const shownDocuments = [];
  class Position {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  }

  class Range {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  }

  class WorkspaceEdit {
    constructor() {
      this.entriesList = [];
    }

    set(uri, edits) {
      this.entriesList.push([uri, edits]);
    }

    entries() {
      return this.entriesList;
    }
  }

  const vscode = {
    CancellationTokenSource: class CancellationTokenSource {
      constructor() {
        this.token = { cancelled: false };
      }
    },
    Position,
    Range,
    WorkspaceEdit,
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
      showInputBox(options) {
        inputBoxes.push(options);
        return Promise.resolve(overrides.inputBoxValue);
      },
      showQuickPick(items) {
        quickPicks.push(items);
        return Promise.resolve(overrides.quickPickSelection || items[2]);
      },
      showTextDocument(document, options) {
        shownDocuments.push({ document, options });
        return Promise.resolve({ document, options });
      },
    },
    workspace: {
      applyEdit(edit) {
        appliedEdits.push(edit);
        return Promise.resolve(true);
      },
      openTextDocument(filename) {
        openedDocuments.push(filename);
        return Promise.resolve({
          fileName: filename,
          uri: { fsPath: filename },
        });
      },
    },
  };
  return {
    appliedEdits,
    commands,
    errors,
    information,
    inputBoxes,
    openedDocuments,
    quickPicks,
    shownDocuments,
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

test("GenerateStubCommandProvider avoids duplicate method names in selected Kotlin files", async () => {
  const { GenerateStubCommandProvider } = require("../src/annotator/generateStub");
  const requests = [];
  const appliedEdits = [];
  const { commands, vscode } = createFakeVscode();
  const project = {
    root() {
      return "/workspace";
    },
  };
  const fileSystem = {
    readFileSync(filename, encoding) {
      assert.equal(filename, "/workspace/src/test/kotlin/Steps.kt");
      assert.equal(encoding, "utf8");
      return [
        "import com.thoughtworks.gauge.Step",
        "",
        "@Step(\"Existing step\")",
        "fun implementation() {",
        "}",
      ].join("\n");
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
    fileSystem,
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
  await command.handler([
    "@com.thoughtworks.gauge.Step(\"Pay with <amount>\")",
    "fun implementation(arg0: Any) {",
    "}",
    "",
  ].join("\n"));

  assert.deepEqual(requests[1], {
    method: "gauge/putStubImpl",
    params: {
      implementationFilePath: "/workspace/src/test/kotlin/Steps.kt",
      codes: [[
        "@com.thoughtworks.gauge.Step(\"Pay with <amount>\")",
        "fun implementation1(arg0: Any) {",
        "}",
        "",
      ].join("\n")],
    },
  });
  assert.deepEqual(appliedEdits, [{ converted: { changes: [] } }]);
});

test("GenerateStubCommandProvider avoids duplicate method names in selected Java files", async () => {
  const { GenerateStubCommandProvider } = require("../src/annotator/generateStub");
  const requests = [];
  const appliedEdits = [];
  const { commands, vscode } = createFakeVscode();
  const project = {
    root() {
      return "/workspace";
    },
    language() {
      return "java";
    },
  };
  const fileSystem = {
    readFileSync(filename, encoding) {
      assert.equal(filename, "/workspace/src/test/java/Steps.java");
      assert.equal(encoding, "utf8");
      return [
        "import com.thoughtworks.gauge.Step;",
        "",
        "public class Steps {",
        "  @Step(\"Existing step\")",
        "  public void implementation() {",
        "  }",
        "}",
      ].join("\n");
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
        return Promise.resolve(["/workspace/src/test/java/Steps.java"]);
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
    fileSystem,
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
  await command.handler([
    "@com.thoughtworks.gauge.Step(\"Pay with <amount>\")",
    "public void implementation(Object arg0) {",
    "}",
    "",
  ].join("\n"));

  assert.deepEqual(requests[1], {
    method: "gauge/putStubImpl",
    params: {
      implementationFilePath: "/workspace/src/test/java/Steps.java",
      codes: [[
        "@com.thoughtworks.gauge.Step(\"Pay with <amount>\")",
        "public void implementation1(Object arg0) {",
        "}",
        "",
      ].join("\n")],
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

test("GenerateStubCommandProvider creates missing files before applying generated edits", async () => {
  const { GenerateStubCommandProvider } = require("../src/annotator/generateStub");
  const requests = [];
  const madeDirectories = [];
  const writes = [];
  const existing = new Set();
  const filename = "/workspace/src/test/kotlin/NewSteps.kt";
  const textEdits = [
    {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
      newText: "fun generatedStep() {}\n",
    },
  ];
  const {
    appliedEdits,
    commands,
    inputBoxes,
    openedDocuments,
    quickPicks,
    shownDocuments,
    vscode,
  } = createFakeVscode({
    inputBoxValue: "src/test/kotlin/NewSteps.kt",
    quickPickSelection: {
      label: "New File",
      description: "Create a new file",
      value: "New File",
    },
  });
  const project = {
    root() {
      return "/workspace";
    },
  };
  const fileSystem = {
    existsSync(candidate) {
      return existing.has(candidate);
    },
    mkdirSync(directory, options) {
      madeDirectories.push({ directory, options });
      existing.add(directory);
    },
    writeFileSync(candidate, content, options) {
      writes.push({ content, filename: candidate, options });
      existing.add(candidate);
    },
  };
  const client = {
    protocol2CodeConverter: {
      asWorkspaceEdit(edit) {
        assert.equal(edit.id, "raw-edit");
        return Promise.resolve({
          entries() {
            return [[{ fsPath: filename }, textEdits]];
          },
        });
      },
    },
    sendRequest(method, params) {
      requests.push({ method, params });
      if (method === "gauge/getImplFiles") {
        return Promise.resolve([]);
      }
      if (method === "gauge/putStubImpl") {
        return Promise.resolve({ id: "raw-edit" });
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
    fileSystem,
    pathModule: path.posix,
    vscode,
  });

  const command = commands.find((entry) => entry.command === "gauge.generate.step");
  await command.handler("fun generatedStep() {}");

  assert.deepEqual(quickPicks[0], [
    { label: "New File", description: "Create a new file", value: "New File" },
    { label: "Copy To Clipboard", description: "", value: "Copy To Clipboard" },
  ]);
  assert.deepEqual(inputBoxes, [
    {
      prompt: "Enter the new Kotlin implementation file path.",
      placeHolder: "src/test/kotlin/Steps.kt",
      value: "src/test/kotlin/Steps.kt",
    },
  ]);
  assert.deepEqual(requests[1], {
    method: "gauge/putStubImpl",
    params: {
      implementationFilePath: filename,
      codes: ["fun generatedStep() {}"],
    },
  });
  assert.deepEqual(madeDirectories, [
    { directory: "/workspace/src/test/kotlin", options: { recursive: true } },
  ]);
  assert.deepEqual(writes, [
    {
      content: "",
      filename,
      options: { encoding: "utf8" },
    },
  ]);
  assert.deepEqual(openedDocuments, [filename]);
  assert.deepEqual(shownDocuments[0].options.selection.start, new vscode.Position(0, 0));
  assert.deepEqual(appliedEdits[0].entries(), [[{ fsPath: filename }, textEdits]]);
});

test("GenerateStubCommandProvider defaults new step files to Java paths for Java projects", async () => {
  const { GenerateStubCommandProvider } = require("../src/annotator/generateStub");
  const requests = [];
  const appliedEdits = [];
  const {
    commands,
    inputBoxes,
    quickPicks,
    vscode,
  } = createFakeVscode({
    inputBoxValue: "src/test/java/NewSteps.java",
    quickPickSelection: {
      label: "New File",
      description: "Create a new file",
      value: "New File",
    },
  });
  const project = {
    root() {
      return "/workspace";
    },
    language() {
      return "java";
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
        return Promise.resolve([]);
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
  await command.handler([
    "@com.thoughtworks.gauge.Step(\"Pay with <amount>\")",
    "public void implementation(Object arg0) {",
    "}",
    "",
  ].join("\n"));

  assert.deepEqual(quickPicks[0], [
    { label: "New File", description: "Create a new file", value: "New File" },
    { label: "Copy To Clipboard", description: "", value: "Copy To Clipboard" },
  ]);
  assert.deepEqual(inputBoxes, [
    {
      prompt: "Enter the new Java implementation file path.",
      placeHolder: "src/test/java/Steps.java",
      value: "src/test/java/Steps.java",
    },
  ]);
  assert.deepEqual(requests[1], {
    method: "gauge/putStubImpl",
    params: {
      implementationFilePath: "/workspace/src/test/java/NewSteps.java",
      codes: [[
        "@com.thoughtworks.gauge.Step(\"Pay with <amount>\")",
        "public void implementation(Object arg0) {",
        "}",
        "",
      ].join("\n")],
    },
  });
  assert.deepEqual(appliedEdits, [{ converted: { changes: [] } }]);
});
