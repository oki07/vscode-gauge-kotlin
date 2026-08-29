const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });
  return { promise, reject, resolve };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function trackCancellationSources(vscode, sources) {
  vscode.CancellationTokenSource = class CancellationTokenSource {
    constructor() {
      this.cancelCalls = 0;
      this.disposeCalls = 0;
      this.token = { isCancellationRequested: false };
      sources.push(this);
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

// On Windows a project root is "C:\\ws\\gauge" and TextDocument.uri.fsPath is
// "C:\\ws\\gauge\\...". The scan normalized the file to forward slashes but built
// its prefix by appending "/" to the raw root, so every candidate was compared
// against "C:\\ws\\gauge/" and filtered out. Generate Step Implementation could
// then only ever offer "New File" on Windows.
test("GenerateStubCommandProvider lists Kotlin files under a Windows project root", async () => {
  const { GenerateStubCommandProvider } = require("../src/annotator/generateStub");
  const { commands, quickPicks, vscode } = createFakeVscode();
  vscode.workspace.findFiles = () => Promise.resolve([
    { fsPath: "C:\\ws\\gauge\\src\\test\\kotlin\\Steps.kt" },
    { fsPath: "C:\\ws\\other\\Other.kt" },
  ]);
  const project = {
    root() {
      return "C:\\ws\\gauge";
    },
  };
  const client = {
    protocol2CodeConverter: {
      asWorkspaceEdit: (edit) => Promise.resolve({ converted: edit }),
    },
    sendRequest(method) {
      if (method === "gauge/getImplFiles") {
        return Promise.resolve([]);
      }
      throw new Error(`Unexpected ${method}`);
    },
  };

  new GenerateStubCommandProvider({ get() { return { project, client }; } }, {
    fileSystem: {
      existsSync: () => true,
      readFileSync: () => "",
    },
    pathModule: path.win32,
    vscode,
  });

  const command = commands.find((entry) => entry.command === "gauge.generate.step");
  await command.handler("fun step() {}");

  assert.deepEqual(
    quickPicks[0].map((entry) => entry.value),
    ["New File", "Copy To Clipboard", "C:\\ws\\gauge\\src\\test\\kotlin\\Steps.kt"],
  );
});

// gauge/getImplFiles is delegated to the runner, and gauge-java's FileHelper
// only scans files ending in .java
// (references/gauge-java/src/main/java/com/thoughtworks/gauge/FileHelper.java).
// A Kotlin project therefore gets an empty list and the picker can only ever
// offer "New File": there is no way to add a step to an existing Kotlin file.
test("GenerateStubCommandProvider lists workspace Kotlin files the Java runner cannot see", async () => {
  const { GenerateStubCommandProvider } = require("../src/annotator/generateStub");
  const { commands, quickPicks, vscode } = createFakeVscode();
  const findFilePatterns = [];
  vscode.workspace.findFiles = (pattern) => {
    findFilePatterns.push(pattern);
    return Promise.resolve([
      { fsPath: "/workspace/src/test/kotlin/Steps.kt" },
      { fsPath: "/workspace/src/test/kotlin/login/LoginSteps.kt" },
      { fsPath: "/elsewhere/Other.kt" },
    ]);
  };
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
    sendRequest(method) {
      if (method === "gauge/getImplFiles") {
        return Promise.resolve([]);
      }
      throw new Error(`Unexpected ${method}`);
    },
  };

  new GenerateStubCommandProvider({ get() { return { project, client }; } }, {
    fileSystem: {
      existsSync() {
        return true;
      },
      readFileSync() {
        return "";
      },
    },
    pathModule: path.posix,
    vscode,
  });

  const command = commands.find((entry) => entry.command === "gauge.generate.step");
  await command.handler("fun step() {}");

  assert.deepEqual(quickPicks[0], [
    { label: "New File", description: "Create a new file", value: "New File" },
    { label: "Copy To Clipboard", description: "", value: "Copy To Clipboard" },
    { label: "Steps.kt", description: "src/test/kotlin", value: "/workspace/src/test/kotlin/Steps.kt" },
    {
      label: "LoginSteps.kt",
      description: "src/test/kotlin/login",
      value: "/workspace/src/test/kotlin/login/LoginSteps.kt",
    },
  ]);
});

// gauge/putStubImpl is answered by gauge-java's StubImplementationCodeProcessor,
// which parses the target with JavaParser
// (references/gauge-java/src/main/java/com/thoughtworks/gauge/connection/StubImplementationCodeProcessor.java).
// Kotlin source is not valid Java, so parsing an existing .kt file yields an
// empty ParseResult and the processor throws on orElseThrow: the quick fix fails
// with no edit. For a new file it writes Java class scaffolding instead. The
// extension already generates the Kotlin stub text itself, so it places it too.
test("GenerateStubCommandProvider writes Kotlin stubs without Gauge LSP", async () => {
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
    existsSync() {
      return true;
    },
    readFileSync() {
      return [
        "package steps",
        "",
        "import com.thoughtworks.gauge.Step",
        "",
        "class Steps {",
        "    @Step(\"an existing step\")",
        "    fun existing() {",
        "    }",
        "}",
        "",
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
      throw new Error(`Unexpected ${method}`);
    },
  };
  const clients = {
    get() {
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
  await command.handler("    @Step(\"a new step\")\n    fun implementation() {\n    }");

  assert.deepEqual(requests.map((entry) => entry.method), ["gauge/getImplFiles"]);
  assert.equal(appliedEdits.length, 1);
  const [[uri, edits]] = appliedEdits[0].entries();
  assert.equal(uri.fsPath, "/workspace/src/test/kotlin/Steps.kt");
  assert.equal(edits.length, 1);
  // Inserted before the closing brace of the last top-level class, which is
  // where gauge-java places it for Java.
  assert.deepEqual({ ...edits[0].range.start }, { line: 8, character: 0 });
  assert.deepEqual({ ...edits[0].range.end }, { line: 8, character: 0 });
  assert.equal(
    edits[0].newText,
    "\n    @Step(\"a new step\")\n    fun implementation() {\n    }\n",
  );
});

// Kotlin allows top-level functions after the class, and the insertion point was
// the last line that is exactly "}" at column 0 - which is that function's
// closing brace. The stub landed INSIDE the function body, where the annotation
// is not a class member and the file does not compile. gauge-java inserts into
// the class for Java (StubImplementationCodeProcessor), and so must this.
test("GenerateStubCommandProvider inserts into the class, not a trailing top-level function", () => {
  const { kotlinStubInsertion } = require("../src/annotator/generateStub");
  const text = [
    "package steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "class StepImplementation {",
    "    @Step(\"an existing step\")",
    "    fun existing() {",
    "    }",
    "}",
    "",
    "fun helper(): Int {",
    "    return 1",
    "}",
    "",
  ].join("\n");

  const insertion = kotlinStubInsertion(text, "    @Step(\"a new step\")\n    fun implementation() {\n    }", "StepImplementation");

  assert.equal(insertion.line, 8);
  assert.equal(insertion.character, 0);
});

test("GenerateStubCommandProvider scaffolds a new Kotlin implementation file", async () => {
  const { GenerateStubCommandProvider } = require("../src/annotator/generateStub");
  const appliedEdits = [];
  const { commands, vscode } = createFakeVscode();
  const project = {
    root() {
      return "/workspace";
    },
  };
  const fileSystem = {
    existsSync() {
      return true;
    },
    readFileSync() {
      return "";
    },
  };
  const client = {
    protocol2CodeConverter: {
      asWorkspaceEdit(edit) {
        return Promise.resolve({ converted: edit });
      },
    },
    sendRequest(method) {
      if (method === "gauge/getImplFiles") {
        return Promise.resolve(["/workspace/src/test/kotlin/Steps.kt"]);
      }
      throw new Error(`Unexpected ${method}`);
    },
  };
  const clients = {
    get() {
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
  await command.handler("    @Step(\"a new step\")\n    fun implementation() {\n    }");

  assert.equal(appliedEdits.length, 1);
  assert.equal(
    appliedEdits[0].entries()[0][1][0].newText,
    [
      "import com.thoughtworks.gauge.Step",
      "",
      "class Steps {",
      "    @Step(\"a new step\")",
      "    fun implementation() {",
      "    }",
      "}",
      "",
    ].join("\n"),
  );
});

// Java implementation files keep the Gauge LSP path: gauge-java's JavaParser
// based writer handles them, and this extension has no reason to reimplement it.
test("GenerateStubCommandProvider writes a selected Java step stub through Gauge LSP", async () => {
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
    { label: "Steps.java", description: "src/test/java", value: "/workspace/src/test/java/Steps.java" },
  ]);
  assert.equal(requests[0].method, "gauge/getImplFiles");
  assert.deepEqual(requests[1], {
    method: "gauge/putStubImpl",
    params: {
      implementationFilePath: "/workspace/src/test/java/Steps.java",
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

  assert.deepEqual(requests.map((entry) => entry.method), ["gauge/getImplFiles"]);
  assert.equal(appliedEdits.length, 1);
  // The file declares no class, interface or object, only a top-level function.
  // Inserting before that function's closing brace put the stub INSIDE its body,
  // so with nothing to insert into the stub is appended instead. The file does
  // not end with a newline, hence the extra one.
  assert.equal(
    appliedEdits[0].entries()[0][1][0].newText,
    `\n\n${[
      "@com.thoughtworks.gauge.Step(\"Pay with <amount>\")",
      "fun implementation1(arg0: Any) {",
      "}",
      "",
    ].join("\n")}\n`,
  );
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
  assert.deepEqual(requests.map((entry) => entry.method), ["gauge/getImplFiles"]);
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
  // The file was created empty, so the Kotlin scaffold fills it.
  assert.equal(appliedEdits[0].entries()[0][0].fsPath, filename);
  assert.equal(
    appliedEdits[0].entries()[0][1][0].newText,
    "import com.thoughtworks.gauge.Step\n\nclass NewSteps {\nfun generatedStep() {}\n}\n",
  );
  assert.equal(textEdits.length, 1);
});

test("GenerateStubCommandProvider creates missing Kotlin files before requesting generated edits", async () => {
  const { GenerateStubCommandProvider } = require("../src/annotator/generateStub");
  const madeDirectories = [];
  const writes = [];
  const existing = new Set();
  const filename = "/workspace/src/test/kotlin/NewSteps.kt";
  const {
    commands,
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
        return Promise.resolve({ converted: edit });
      },
    },
    sendRequest(method, params) {
      if (method === "gauge/getImplFiles") {
        return Promise.resolve([]);
      }
      if (method === "gauge/putStubImpl") {
        assert.equal(params.implementationFilePath, filename);
        assert.equal(existing.has(filename), true);
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
    workspaceEditorFactory() {
      return {
        applyChanges() {
          return Promise.resolve(undefined);
        },
      };
    },
  });

  const command = commands.find((entry) => entry.command === "gauge.generate.step");
  await command.handler("fun generatedStep() {}");

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
});

test("GenerateStubCommandProvider defaults new step files to Java paths for Java projects", async () => {
  const { GenerateStubCommandProvider } = require("../src/annotator/generateStub");
  const requests = [];
  const appliedEdits = [];
  const events = [];
  const existing = new Set();
  const writes = [];
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
        events.push("request");
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
  const fileSystem = {
    existsSync(candidate) {
      return existing.has(candidate);
    },
    mkdirSync(directory, options) {
      events.push("mkdir");
      existing.add(directory);
      writes.push({ directory, options });
    },
    writeFileSync(candidate, content, options) {
      events.push("write");
      existing.add(candidate);
      writes.push({ content, filename: candidate, options });
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
  assert.deepEqual(writes, [
    {
      directory: "/workspace/src/test/java",
      options: { recursive: true },
    },
    {
      content: "",
      filename: "/workspace/src/test/java/NewSteps.java",
      options: { encoding: "utf8" },
    },
  ]);
  assert.deepEqual(events, ["mkdir", "write", "request"]);
  assert.deepEqual(appliedEdits, [{ converted: { changes: [] } }]);
});

test("GenerateStubCommandProvider ignores retained commands after disposal", async () => {
  const { GenerateStubCommandProvider } = require("../src/annotator/generateStub");
  const fake = createFakeVscode();
  const registrationDisposeCalls = new Map();
  fake.vscode.commands.registerCommand = (command, handler) => {
    fake.commands.push({ command, handler });
    registrationDisposeCalls.set(command, 0);
    return {
      dispose() {
        registrationDisposeCalls.set(command, registrationDisposeCalls.get(command) + 1);
      },
    };
  };
  let clientLookups = 0;
  const provider = new GenerateStubCommandProvider({
    get() {
      clientLookups += 1;
      return undefined;
    },
  }, {
    pathModule: path.posix,
    vscode: fake.vscode,
  });
  const stepHandler = fake.commands.find(
    (entry) => entry.command === "gauge.generate.step",
  ).handler;
  const conceptHandler = fake.commands.find(
    (entry) => entry.command === "gauge.generate.concept",
  ).handler;

  provider.dispose();
  provider.dispose();
  const outcomes = await Promise.allSettled([
    Promise.resolve().then(() => stepHandler("fun step() {}")),
    Promise.resolve().then(() => conceptHandler({ conceptName: "# Shared" })),
    Promise.resolve().then(() => provider.generateStepStub("fun direct() {}")),
    Promise.resolve().then(() => provider.generateConceptStub({ conceptName: "# Direct" })),
  ]);

  assert.deepEqual({
    activeOperations: provider.activeOperations && provider.activeOperations.size,
    clientLookups,
    errors: fake.errors,
    information: fake.information,
    inputBoxes: fake.inputBoxes.length,
    outcomes,
    quickPicks: fake.quickPicks.length,
    registrationDisposeCalls: Object.fromEntries(registrationDisposeCalls),
  }, {
    activeOperations: 0,
    clientLookups: 0,
    errors: [],
    information: [],
    inputBoxes: 0,
    outcomes: [
      { status: "fulfilled", value: undefined },
      { status: "fulfilled", value: undefined },
      { status: "fulfilled", value: undefined },
      { status: "fulfilled", value: undefined },
    ],
    quickPicks: 0,
    registrationDisposeCalls: {
      "gauge.generate.concept": 1,
      "gauge.generate.step": 1,
    },
  });
});

test("GenerateStubCommandProvider cancels pending file-list requests on disposal", async () => {
  const { GenerateStubCommandProvider } = require("../src/annotator/generateStub");

  for (const route of ["step", "concept"]) {
    for (const settlement of ["resolve", "reject"]) {
      const fake = createFakeVscode();
      const sources = [];
      trackCancellationSources(fake.vscode, sources);
      const request = deferred();
      const requestEntered = deferred();
      const requestCalls = [];
      fake.vscode.window.showQuickPick = (items) => {
        fake.quickPicks.push(items);
        return Promise.resolve(undefined);
      };
      const requestError = new Error(`disposed ${route} files failed`);
      const provider = new GenerateStubCommandProvider({
        get() {
          return {
            client: {
              sendRequest(...args) {
                requestCalls.push(args);
                requestEntered.resolve();
                return request.promise;
              },
            },
            project: {
              root() {
                return "/workspace";
              },
            },
          };
        },
      }, {
        pathModule: path.posix,
        vscode: fake.vscode,
      });
      const handler = fake.commands.find(
        (entry) => entry.command === `gauge.generate.${route}`,
      ).handler;
      let settled = false;
      const pending = handler(route === "step" ? "fun step() {}" : { conceptName: "# Shared" })
        .then((value) => {
          settled = true;
          return value;
        });

      await requestEntered.promise;
      provider.dispose();
      await nextTurn();
      const snapshot = {
        activeOperations: provider.activeOperations && provider.activeOperations.size,
        cancelCalls: sources[0].cancelCalls,
        disposeCalls: sources[0].disposeCalls,
        settled,
      };
      if (settlement === "resolve") {
        request.resolve([]);
      } else {
        request.reject(requestError);
      }
      const outcome = await Promise.allSettled([pending]);
      await nextTurn();

      const expectedArgs = route === "step"
        ? ["gauge/getImplFiles", sources[0].token]
        : ["gauge/getImplFiles", { concept: true }, sources[0].token];
      assert.deepEqual({
        ...snapshot,
        errors: fake.errors,
        information: fake.information,
        outcome,
        quickPicks: fake.quickPicks.length,
        requestArgs: requestCalls[0],
        route,
        settlement,
        tokenCancelled: sources[0].token.isCancellationRequested,
      }, {
        activeOperations: 0,
        cancelCalls: 1,
        disposeCalls: 1,
        errors: [],
        information: [],
        outcome: [{ status: "fulfilled", value: undefined }],
        quickPicks: 0,
        requestArgs: expectedArgs,
        route,
        settled: true,
        settlement,
        tokenCancelled: true,
      });
    }
  }

  const liveFake = createFakeVscode();
  const liveSources = [];
  trackCancellationSources(liveFake.vscode, liveSources);
  const liveError = new Error("live files failed");
  const liveProvider = new GenerateStubCommandProvider({
    get() {
      return {
        client: {
          sendRequest() {
            return Promise.reject(liveError);
          },
        },
        project: {
          root() {
            return "/workspace";
          },
        },
      };
    },
  }, {
    pathModule: path.posix,
    vscode: liveFake.vscode,
  });
  const liveHandler = liveFake.commands.find(
    (entry) => entry.command === "gauge.generate.step",
  ).handler;

  await liveHandler("fun step() {}");

  assert.deepEqual({
    activeOperations: liveProvider.activeOperations && liveProvider.activeOperations.size,
    cancelCalls: liveSources[0].cancelCalls,
    disposeCalls: liveSources[0].disposeCalls,
    errors: liveFake.errors,
  }, {
    activeOperations: 0,
    cancelCalls: 0,
    disposeCalls: 1,
    errors: [`Unable to generate implementation. ${liveError}`],
  });
});

test("GenerateStubCommandProvider stops pending selection side effects on disposal", async () => {
  const { GenerateStubCommandProvider } = require("../src/annotator/generateStub");

  for (const scenario of ["quickPick", "newFileInput", "clipboardResolve", "clipboardReject"]) {
    const fake = createFakeVscode();
    const sources = [];
    trackCancellationSources(fake.vscode, sources);
    const gate = deferred();
    const entered = deferred();
    const madeDirectories = [];
    const writes = [];
    const requestMethods = [];
    let applyCalls = 0;
    let clipboardCalls = 0;
    let converterCalls = 0;
    let factoryCalls = 0;
    const fileSystem = {
      existsSync() {
        return false;
      },
      mkdirSync(directory) {
        madeDirectories.push(directory);
      },
      writeFileSync(filename) {
        writes.push(filename);
      },
    };
    if (scenario === "quickPick") {
      fake.vscode.window.showQuickPick = (items) => {
        fake.quickPicks.push(items);
        entered.resolve();
        return gate.promise;
      };
    } else if (scenario === "newFileInput") {
      fake.vscode.window.showQuickPick = (items) => {
        fake.quickPicks.push(items);
        return Promise.resolve(items[0]);
      };
      fake.vscode.window.showInputBox = (options) => {
        fake.inputBoxes.push(options);
        entered.resolve();
        return gate.promise;
      };
    } else {
      fake.vscode.window.showQuickPick = (items) => {
        fake.quickPicks.push(items);
        return Promise.resolve(items[1]);
      };
      fake.vscode.env.clipboard.writeText = () => {
        clipboardCalls += 1;
        entered.resolve();
        return gate.promise;
      };
    }
    const client = {
      protocol2CodeConverter: {
        asWorkspaceEdit(edit) {
          converterCalls += 1;
          return Promise.resolve(edit);
        },
      },
      sendRequest(method) {
        requestMethods.push(method);
        if (method === "gauge/getImplFiles") {
          return Promise.resolve([]);
        }
        return Promise.resolve({ changes: [] });
      },
    };
    const provider = new GenerateStubCommandProvider({
      get() {
        return {
          client,
          project: {
            root() {
              return "/workspace";
            },
          },
        };
      },
    }, {
      fileSystem,
      pathModule: path.posix,
      vscode: fake.vscode,
      workspaceEditorFactory() {
        factoryCalls += 1;
        return {
          applyChanges() {
            applyCalls += 1;
            return Promise.resolve(true);
          },
        };
      },
    });
    const handler = fake.commands.find(
      (entry) => entry.command === "gauge.generate.step",
    ).handler;
    let settled = false;
    const pending = handler("fun step() {}").then((value) => {
      settled = true;
      return value;
    });

    await entered.promise;
    provider.dispose();
    await nextTurn();
    const snapshot = {
      activeOperations: provider.activeOperations && provider.activeOperations.size,
      settled,
    };
    if (scenario === "quickPick") {
      gate.resolve(undefined);
    } else if (scenario === "newFileInput") {
      gate.resolve("src/test/kotlin/NewSteps.kt");
    } else if (scenario === "clipboardResolve") {
      gate.resolve(undefined);
    } else {
      gate.reject(new Error("disposed clipboard failed"));
    }
    const outcome = await Promise.allSettled([pending]);
    await nextTurn();

    assert.deepEqual({
      ...snapshot,
      applyCalls,
      cancelCalls: sources[0].cancelCalls,
      clipboardCalls,
      converterCalls,
      disposeCalls: sources[0].disposeCalls,
      errors: fake.errors,
      factoryCalls,
      information: fake.information,
      inputBoxes: fake.inputBoxes.length,
      madeDirectories,
      outcome,
      quickPicks: fake.quickPicks.length,
      requestMethods,
      scenario,
      writes,
    }, {
      activeOperations: 0,
      applyCalls: 0,
      cancelCalls: 0,
      clipboardCalls: scenario.startsWith("clipboard") ? 1 : 0,
      converterCalls: 0,
      disposeCalls: 1,
      errors: [],
      factoryCalls: 0,
      information: [],
      inputBoxes: scenario === "newFileInput" ? 1 : 0,
      madeDirectories: [],
      outcome: [{ status: "fulfilled", value: undefined }],
      quickPicks: 1,
      requestMethods: ["gauge/getImplFiles"],
      scenario,
      settled: true,
      writes: [],
    });
  }
});

test("GenerateStubCommandProvider detaches generated edit stages on disposal", async () => {
  const { GenerateStubCommandProvider } = require("../src/annotator/generateStub");

  for (const stage of ["request", "converter", "apply"]) {
    for (const settlement of ["resolve", "reject"]) {
      const fake = createFakeVscode();
      const sources = [];
      trackCancellationSources(fake.vscode, sources);
      const gate = deferred();
      const entered = deferred();
      const requestMethods = [];
      let applyCalls = 0;
      let converterCalls = 0;
      let factoryCalls = 0;
      const stageError = new Error(`disposed ${stage} failed`);
      const client = {
        protocol2CodeConverter: {
          asWorkspaceEdit(edit) {
            converterCalls += 1;
            if (stage === "converter") {
              entered.resolve();
              return gate.promise;
            }
            return Promise.resolve({ converted: edit });
          },
        },
        sendRequest(method) {
          requestMethods.push(method);
          if (method === "gauge/getImplFiles") {
            return Promise.resolve(["/workspace/src/test/java/Steps.java"]);
          }
          if (stage === "request") {
            entered.resolve();
            return gate.promise;
          }
          return Promise.resolve({ changes: [] });
        },
      };
      const provider = new GenerateStubCommandProvider({
        get() {
          return {
            client,
            project: {
              root() {
                return "/workspace";
              },
            },
          };
        },
      }, {
        pathModule: path.posix,
        vscode: fake.vscode,
        workspaceEditorFactory() {
          factoryCalls += 1;
          return {
            applyChanges() {
              applyCalls += 1;
              if (stage === "apply") {
                entered.resolve();
                return gate.promise;
              }
              return Promise.resolve(true);
            },
          };
        },
      });
      const handler = fake.commands.find(
        (entry) => entry.command === "gauge.generate.step",
      ).handler;
      let settled = false;
      const pending = handler("fun step() {}").then((value) => {
        settled = true;
        return value;
      });

      await entered.promise;
      provider.dispose();
      await nextTurn();
      const snapshot = {
        activeOperations: provider.activeOperations && provider.activeOperations.size,
        settled,
      };
      if (settlement === "resolve") {
        gate.resolve(stage === "request" ? { changes: [] } : { converted: true });
      } else {
        gate.reject(stageError);
      }
      const outcome = await Promise.allSettled([pending]);
      await nextTurn();

      const expectedCounts = {
        apply: { applyCalls: 1, converterCalls: 1, factoryCalls: 1 },
        converter: { applyCalls: 0, converterCalls: 1, factoryCalls: 0 },
        request: { applyCalls: 0, converterCalls: 0, factoryCalls: 0 },
      }[stage];
      assert.deepEqual({
        ...snapshot,
        ...expectedCounts,
        cancelCalls: sources.map((source) => source.cancelCalls),
        disposeCalls: sources.map((source) => source.disposeCalls),
        errors: fake.errors,
        information: fake.information,
        outcome,
        requestMethods,
        settlement,
        stage,
      }, {
        activeOperations: 0,
        ...expectedCounts,
        cancelCalls: stage === "request" ? [0, 1] : [0, 0],
        disposeCalls: [1, 1],
        errors: [],
        information: [],
        outcome: [{ status: "fulfilled", value: undefined }],
        requestMethods: ["gauge/getImplFiles", "gauge/putStubImpl"],
        settled: true,
        settlement,
        stage,
      });
    }
  }
});

test("GenerateStubCommandProvider stops the default workspace editor after disposal", async () => {
  const { GenerateStubCommandProvider } = require("../src/annotator/generateStub");

  for (const stage of ["open", "show", "apply"]) {
    const filename = "/workspace/src/test/java/Steps.java";
    const fake = createFakeVscode({
      quickPickSelection: {
        label: "Steps.kt",
        description: "src/test/kotlin",
        value: filename,
      },
    });
    const gate = deferred();
    const entered = deferred();
    let applyCalls = 0;
    let openCalls = 0;
    let showCalls = 0;
    fake.vscode.workspace.openTextDocument = () => {
      openCalls += 1;
      if (stage === "open") {
        entered.resolve();
        return gate.promise;
      }
      return Promise.resolve({ fileName: filename, uri: { fsPath: filename } });
    };
    fake.vscode.window.showTextDocument = () => {
      showCalls += 1;
      if (stage === "show") {
        entered.resolve();
        return gate.promise;
      }
      return Promise.resolve(undefined);
    };
    fake.vscode.workspace.applyEdit = () => {
      applyCalls += 1;
      if (stage === "apply") {
        entered.resolve();
        return gate.promise;
      }
      return Promise.resolve(true);
    };
    const client = {
      protocol2CodeConverter: {
        asWorkspaceEdit() {
          return Promise.resolve({
            entries() {
              return [[{ fsPath: filename }, [{
                newText: "fun step() {}\n",
                range: {
                  end: { character: 0, line: 0 },
                  start: { character: 0, line: 0 },
                },
              }]]];
            },
          });
        },
      },
      sendRequest(method) {
        if (method === "gauge/getImplFiles") {
          return Promise.resolve([filename]);
        }
        return Promise.resolve({ changes: [] });
      },
    };
    const provider = new GenerateStubCommandProvider({
      get() {
        return {
          client,
          project: {
            root() {
              return "/workspace";
            },
          },
        };
      },
    }, {
      fileSystem: {
        existsSync() {
          return true;
        },
      },
      pathModule: path.posix,
      vscode: fake.vscode,
    });
    const handler = fake.commands.find(
      (entry) => entry.command === "gauge.generate.step",
    ).handler;
    let settled = false;
    const pending = handler("fun step() {}").then((value) => {
      settled = true;
      return value;
    });

    await entered.promise;
    provider.dispose();
    await nextTurn();
    const snapshot = {
      activeOperations: provider.activeOperations && provider.activeOperations.size,
      applyCalls,
      openCalls,
      settled,
      showCalls,
    };
    if (stage === "apply") {
      gate.reject(new Error("disposed workspace apply failed"));
    } else {
      gate.resolve({ fileName: filename, uri: { fsPath: filename } });
    }
    const outcome = await Promise.allSettled([pending]);
    await nextTurn();

    assert.deepEqual({
      ...snapshot,
      applyCallsAfterSettlement: applyCalls,
      errors: fake.errors,
      information: fake.information,
      openCallsAfterSettlement: openCalls,
      outcome,
      showCallsAfterSettlement: showCalls,
      stage,
    }, {
      activeOperations: 0,
      applyCalls: stage === "apply" ? 1 : 0,
      applyCallsAfterSettlement: stage === "apply" ? 1 : 0,
      errors: [],
      information: [],
      openCalls: 1,
      openCallsAfterSettlement: 1,
      outcome: [{ status: "fulfilled", value: undefined }],
      settled: true,
      showCalls: stage === "open" ? 0 : 1,
      showCallsAfterSettlement: stage === "open" ? 0 : 1,
      stage,
    });
  }
});

test("GenerateStubCommandProvider preserves live generated-edit failures and releases request sources", async () => {
  const { GenerateStubCommandProvider } = require("../src/annotator/generateStub");

  for (const stage of ["request", "converter", "factory", "apply"]) {
    const filename = "/workspace/src/test/java/Steps.java";
    const fake = createFakeVscode({
      quickPickSelection: {
        label: "Steps.kt",
        description: "src/test/kotlin",
        value: filename,
      },
    });
    const sources = [];
    trackCancellationSources(fake.vscode, sources);
    const stageError = new Error(`live ${stage} failed`);
    let applyCalls = 0;
    let converterCalls = 0;
    let factoryCalls = 0;
    const client = {
      protocol2CodeConverter: {
        asWorkspaceEdit(edit) {
          converterCalls += 1;
          if (stage === "converter") {
            return Promise.reject(stageError);
          }
          return Promise.resolve({ converted: edit });
        },
      },
      sendRequest(method) {
        if (method === "gauge/getImplFiles") {
          return Promise.resolve([filename]);
        }
        if (stage === "request") {
          return Promise.reject(stageError);
        }
        return Promise.resolve({ changes: [] });
      },
    };
    const provider = new GenerateStubCommandProvider({
      get() {
        return {
          client,
          project: {
            root() {
              return "/workspace";
            },
          },
        };
      },
    }, {
      pathModule: path.posix,
      vscode: fake.vscode,
      workspaceEditorFactory() {
        factoryCalls += 1;
        if (stage === "factory") {
          throw stageError;
        }
        return {
          applyChanges() {
            applyCalls += 1;
            if (stage === "apply") {
              return Promise.reject(stageError);
            }
            return Promise.resolve(true);
          },
        };
      },
    });
    const handler = fake.commands.find(
      (entry) => entry.command === "gauge.generate.step",
    ).handler;

    const outcome = await Promise.allSettled([handler("fun step() {}")]);

    const expectedCounts = {
      apply: { applyCalls: 1, converterCalls: 1, factoryCalls: 1 },
      converter: { applyCalls: 0, converterCalls: 1, factoryCalls: 0 },
      factory: { applyCalls: 0, converterCalls: 1, factoryCalls: 1 },
      request: { applyCalls: 0, converterCalls: 0, factoryCalls: 0 },
    }[stage];
    assert.deepEqual({
      activeOperations: provider.activeOperations.size,
      ...expectedCounts,
      cancelCalls: sources.map((source) => source.cancelCalls),
      disposeCalls: sources.map((source) => source.disposeCalls),
      errors: fake.errors,
      information: fake.information,
      outcome,
      stage,
    }, {
      activeOperations: 0,
      ...expectedCounts,
      cancelCalls: [0, 0],
      disposeCalls: [1, 1],
      errors: [`Unable to generate implementation. ${stageError}`],
      information: [],
      outcome: [{ status: "fulfilled", value: undefined }],
      stage,
    });
  }
});

test("GenerateStubCommandProvider preserves live clipboard notification failures", async () => {
  const { GenerateStubCommandProvider } = require("../src/annotator/generateStub");
  const fake = createFakeVscode({
    quickPickSelection: {
      label: "Copy To Clipboard",
      description: "",
      value: "Copy To Clipboard",
    },
  });
  const sources = [];
  trackCancellationSources(fake.vscode, sources);
  const notificationError = new Error("live clipboard notification failed");
  fake.vscode.window.showInformationMessage = (message) => {
    fake.information.push(message);
    return Promise.reject(notificationError);
  };
  const provider = new GenerateStubCommandProvider({
    get() {
      return {
        client: {
          sendRequest() {
            return Promise.resolve([]);
          },
        },
        project: {
          root() {
            return "/workspace";
          },
        },
      };
    },
  }, {
    pathModule: path.posix,
    vscode: fake.vscode,
  });
  const handler = fake.commands.find(
    (entry) => entry.command === "gauge.generate.step",
  ).handler;

  const outcome = await Promise.allSettled([handler("fun step() {}")]);

  assert.deepEqual({
    activeOperations: provider.activeOperations.size,
    cancelCalls: sources[0].cancelCalls,
    disposeCalls: sources[0].disposeCalls,
    errors: fake.errors,
    information: fake.information,
    outcome,
  }, {
    activeOperations: 0,
    cancelCalls: 0,
    disposeCalls: 1,
    errors: [],
    information: ["Step Implementation copied to clipboard"],
    outcome: [{ status: "rejected", reason: notificationError }],
  });
});

test("GenerateStubCommandProvider stops synchronous disposal reentrancy at operation boundaries", async () => {
  const { GenerateStubCommandProvider } = require("../src/annotator/generateStub");

  for (const boundary of ["source", "request", "factory", "newFileFs", "workspaceFs"]) {
    const filename = boundary === "newFileFs"
      ? "/workspace/src/test/java/NewSteps.java"
      : "/workspace/src/test/java/Steps.java";
    const fake = createFakeVscode({
      inputBoxValue: "src/test/java/NewSteps.java",
      quickPickSelection: boundary === "newFileFs"
        ? { label: "New File", description: "Create a new file", value: "New File" }
        : { label: "Steps.java", description: "src/test/java", value: filename },
    });
    const sources = [];
    const boundaryError = new Error(`disposed during ${boundary}`);
    let applyCalls = 0;
    let converterCalls = 0;
    let mkdirCalls = 0;
    let openCalls = 0;
    let provider;
    let requestCalls = 0;
    let writeCalls = 0;
    if (boundary === "source") {
      fake.vscode.CancellationTokenSource = class CancellationTokenSource {
        constructor() {
          this.cancelCalls = 0;
          this.disposeCalls = 0;
          this.token = { isCancellationRequested: false };
          sources.push(this);
          provider.dispose();
        }

        cancel() {
          this.cancelCalls += 1;
          this.token.isCancellationRequested = true;
        }

        dispose() {
          this.disposeCalls += 1;
        }
      };
    } else {
      trackCancellationSources(fake.vscode, sources);
    }
    fake.vscode.workspace.openTextDocument = () => {
      openCalls += 1;
      return Promise.resolve({ fileName: filename, uri: { fsPath: filename } });
    };
    const fileSystem = {
      existsSync() {
        if (boundary === "newFileFs" || boundary === "workspaceFs") {
          provider.dispose();
        }
        return boundary === "workspaceFs";
      },
      mkdirSync() {
        mkdirCalls += 1;
      },
      writeFileSync() {
        writeCalls += 1;
      },
    };
    const client = {
      protocol2CodeConverter: {
        asWorkspaceEdit() {
          converterCalls += 1;
          return Promise.resolve({
            entries() {
              return [[{ fsPath: filename }, []]];
            },
          });
        },
      },
      sendRequest(method) {
        requestCalls += 1;
        if (method === "gauge/getImplFiles") {
          return Promise.resolve(boundary === "newFileFs" ? [] : [filename]);
        }
        if (boundary === "request") {
          provider.dispose();
          return Promise.reject(boundaryError);
        }
        return Promise.resolve({ changes: [] });
      },
    };
    const options = {
      fileSystem,
      pathModule: path.posix,
      vscode: fake.vscode,
    };
    if (boundary === "factory") {
      options.workspaceEditorFactory = () => {
        provider.dispose();
        return {
          applyChanges() {
            applyCalls += 1;
            return Promise.resolve(true);
          },
        };
      };
    }
    provider = new GenerateStubCommandProvider({
      get() {
        return {
          client,
          project: {
            root() {
              return "/workspace";
            },
          },
        };
      },
    }, options);
    const handler = fake.commands.find(
      (entry) => entry.command === "gauge.generate.step",
    ).handler;

    const outcome = await Promise.allSettled([handler("fun step() {}")]);
    await nextTurn();

    const expectedSources = boundary === "source"
      ? [{ cancelCalls: 1, disposeCalls: 1 }]
      : boundary === "request"
        ? [{ cancelCalls: 0, disposeCalls: 1 }, { cancelCalls: 1, disposeCalls: 1 }]
        : boundary === "newFileFs"
          ? [{ cancelCalls: 0, disposeCalls: 1 }]
          : [{ cancelCalls: 0, disposeCalls: 1 }, { cancelCalls: 0, disposeCalls: 1 }];
    assert.deepEqual({
      activeOperations: provider.activeOperations.size,
      applyCalls,
      boundary,
      converterCalls,
      errors: fake.errors,
      information: fake.information,
      mkdirCalls,
      openCalls,
      outcome,
      requestCalls,
      sources: sources.map((source) => ({
        cancelCalls: source.cancelCalls,
        disposeCalls: source.disposeCalls,
      })),
      writeCalls,
    }, {
      activeOperations: 0,
      applyCalls: 0,
      boundary,
      converterCalls: ["factory", "workspaceFs"].includes(boundary) ? 1 : 0,
      errors: [],
      information: [],
      mkdirCalls: 0,
      openCalls: 0,
      outcome: [{ status: "fulfilled", value: undefined }],
      requestCalls: boundary === "source" ? 0 : boundary === "newFileFs" ? 1 : 2,
      sources: expectedSources,
      writeCalls: 0,
    });
  }
});

test("GenerateStubCommandProvider cancels concurrent step and concept operations exactly once", async () => {
  const { GenerateStubCommandProvider } = require("../src/annotator/generateStub");
  const fake = createFakeVscode();
  const sources = [];
  trackCancellationSources(fake.vscode, sources);
  const entered = deferred();
  const gates = [deferred(), deferred()];
  let requestCalls = 0;
  const provider = new GenerateStubCommandProvider({
    get() {
      return {
        client: {
          sendRequest() {
            const gate = gates[requestCalls];
            requestCalls += 1;
            if (requestCalls === gates.length) {
              entered.resolve();
            }
            return gate.promise;
          },
        },
        project: {
          root() {
            return "/workspace";
          },
        },
      };
    },
  }, {
    pathModule: path.posix,
    vscode: fake.vscode,
  });
  const stepHandler = fake.commands.find(
    (entry) => entry.command === "gauge.generate.step",
  ).handler;
  const conceptHandler = fake.commands.find(
    (entry) => entry.command === "gauge.generate.concept",
  ).handler;
  let settled = 0;
  const pending = [
    stepHandler("fun step() {}"),
    conceptHandler({ conceptName: "# Shared" }),
  ].map((promise) => promise.then((value) => {
    settled += 1;
    return value;
  }));

  await entered.promise;
  provider.dispose();
  provider.dispose();
  await nextTurn();
  const snapshot = {
    activeOperations: provider.activeOperations.size,
    settled,
    sources: sources.map((source) => ({
      cancelCalls: source.cancelCalls,
      disposeCalls: source.disposeCalls,
    })),
  };
  gates[0].resolve([]);
  gates[1].reject(new Error("disposed concurrent concept failed"));
  const outcomes = await Promise.allSettled(pending);
  await nextTurn();

  assert.deepEqual({
    ...snapshot,
    errors: fake.errors,
    information: fake.information,
    outcomes,
    quickPicks: fake.quickPicks.length,
    requestCalls,
  }, {
    activeOperations: 0,
    errors: [],
    information: [],
    outcomes: [
      { status: "fulfilled", value: undefined },
      { status: "fulfilled", value: undefined },
    ],
    quickPicks: 0,
    requestCalls: 2,
    settled: 2,
    sources: [
      { cancelCalls: 1, disposeCalls: 1 },
      { cancelCalls: 1, disposeCalls: 1 },
    ],
  });
});

// applyChanges() already returns false when VS Code refuses the edit - a
// read-only file, a file changed underneath, a failed create. Dropping that
// answer left the user with a quick fix that reported success and wrote nothing.
test("GenerateStubCommandProvider reports a workspace edit VS Code refused", async () => {
  const { GenerateStubCommandProvider } = require("../src/annotator/generateStub");
  const { commands, errors, vscode } = createFakeVscode();
  const project = { root() { return "/workspace"; } };
  const client = {
    protocol2CodeConverter: { asWorkspaceEdit: (edit) => Promise.resolve({ converted: edit }) },
    sendRequest(method) {
      if (method === "gauge/getImplFiles") {
        return Promise.resolve(["/workspace/src/test/kotlin/Steps.kt"]);
      }
      throw new Error(`Unexpected ${method}`);
    },
  };

  new GenerateStubCommandProvider({ get() { return { project, client }; } }, {
    fileSystem: { existsSync: () => true, readFileSync: () => "" },
    pathModule: path.posix,
    vscode,
    workspaceEditorFactory() {
      return { applyChanges: () => Promise.resolve(false) };
    },
  });

  const command = commands.find((entry) => entry.command === "gauge.generate.step");
  await command.handler("fun step() {}");

  assert.deepEqual(errors, [
    "Unable to generate implementation. The edit was not applied.",
  ]);
  assert.deepEqual(commands.filter((entry) => entry.command === "vscode.open"), []);
});

// clients.get() answers undefined when no Gauge language client is running for
// the active file - the daemon has not started yet, it died, or the file is
// outside a Gauge project. The command then read .client off undefined and the
// user saw a raw TypeError. Upstream's identical unguarded access is unreachable
// because there the quick fix is produced by the Gauge server itself
// (references/gauge/api/lang/codeAction.go), so it only exists when a client does.
test("GenerateStubCommandProvider explains that no Gauge project is running", async () => {
  const { GenerateStubCommandProvider } = require("../src/annotator/generateStub");
  const { commands, errors, vscode } = createFakeVscode();

  new GenerateStubCommandProvider({ get() { return undefined; } }, {
    pathModule: path.posix,
    vscode,
  });

  const command = commands.find((entry) => entry.command === "gauge.generate.step");
  await command.handler("fun step() {}");

  assert.deepEqual(errors, [
    "Unable to generate implementation. No Gauge project is running for this file.",
  ]);
});

test("GenerateStubCommandProvider explains a missing Gauge project for concepts too", async () => {
  const { GenerateStubCommandProvider } = require("../src/annotator/generateStub");
  const { commands, errors, vscode } = createFakeVscode();

  new GenerateStubCommandProvider({ get() { return undefined; } }, {
    pathModule: path.posix,
    vscode,
  });

  const command = commands.find((entry) => entry.command === "gauge.generate.concept");
  await command.handler({ conceptName: "a concept" });

  assert.deepEqual(errors, [
    "Unable to generate implementation. No Gauge project is running for this file.",
  ]);
});
