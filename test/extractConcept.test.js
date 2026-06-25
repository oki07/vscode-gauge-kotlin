const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

function createDocument(text, fsPath = "/workspace/gauge/specs/example.spec") {
  const lines = text.split("\n");
  return {
    fileName: fsPath,
    languageId: "gauge",
    lineCount: lines.length,
    uri: { fsPath },
    getText() {
      return text;
    },
    lineAt(line) {
      return { text: lines[line] };
    },
  };
}

function createFakeVscode(options = {}) {
  const commands = [];
  const errors = [];
  const information = [];
  const inputs = [];
  const quickPicks = [];
  const appliedEdits = [];
  const conceptDocuments = options.conceptDocuments || {};
  const inputResponses = [...(options.inputResponses || [])];

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
      this.createdFiles = [];
      this.replacements = [];
    }

    createFile(uri, options) {
      this.createdFiles.push({ uri, options });
    }

    replace(uri, range, newText) {
      this.replacements.push({ uri, range, newText });
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
    Uri: {
      file(fsPath) {
        return { fsPath };
      },
    },
    WorkspaceEdit,
    commands: {
      registerCommand(command, handler) {
        commands.push({ command, handler });
        return { dispose() {} };
      },
    },
    window: {
      activeTextEditor: {
        document: options.document,
        selection: options.selection,
      },
      showErrorMessage(message) {
        errors.push(message);
        return Promise.resolve(undefined);
      },
      showInformationMessage(message) {
        information.push(message);
        return Promise.resolve(undefined);
      },
      showInputBox(inputOptions) {
        inputs.push(inputOptions);
        return Promise.resolve(inputResponses.shift());
      },
      showQuickPick(items, quickPickOptions) {
        quickPicks.push({ items, options: quickPickOptions });
        return Promise.resolve(options.quickPickSelection || items[1] || items[0]);
      },
    },
    workspace: {
      applyEdit(edit) {
        appliedEdits.push(edit);
        return Promise.resolve(true);
      },
      openTextDocument(uri) {
        const text = conceptDocuments[uri.fsPath];
        if (text === undefined) {
          return Promise.reject(new Error(`Missing document ${uri.fsPath}`));
        }
        return Promise.resolve(createDocument(text, uri.fsPath));
      },
    },
  };

  return {
    appliedEdits,
    commands,
    errors,
    information,
    inputs,
    quickPicks,
    vscode,
  };
}

function createClients(requests, conceptFiles = ["/workspace/gauge/specs/concepts.cpt"]) {
  return {
    get(fsPath) {
      assert.equal(fsPath, "/workspace/gauge/specs/example.spec");
      return {
        client: {
          sendRequest(method, params, token) {
            requests.push({ method, params, token });
            assert.equal(method, "gauge/getImplFiles");
            assert.deepEqual(params, { concept: true });
            return Promise.resolve(conceptFiles);
          },
        },
        project: {
          root() {
            return "/workspace/gauge";
          },
        },
      };
    },
  };
}

test("ExtractConceptCommandProvider extracts selected Gauge steps into an existing concept file", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const requests = [];
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Login as <user>",
    "* Buy item",
    "",
  ].join("\n"));
  const {
    appliedEdits,
    commands,
    inputs,
    quickPicks,
    vscode,
  } = createFakeVscode({
    conceptDocuments: {
      "/workspace/gauge/specs/concepts.cpt": "# Existing\n* setup\n",
    },
    document,
    inputResponses: ["Shared checkout <user>"],
    quickPickSelection: {
      label: "concepts.cpt",
      description: "specs",
      value: "/workspace/gauge/specs/concepts.cpt",
    },
    selection: {
      start: { line: 3, character: 0 },
      end: { line: 4, character: 10 },
    },
  });

  new ExtractConceptCommandProvider(createClients(requests), {
    pathModule: path.posix,
    vscode,
  });

  const command = commands.find((entry) => entry.command === "gauge.extract.concept");
  assert.ok(command);

  await command.handler();

  assert.equal(inputs[0].placeHolder, "Enter the concept name");
  assert.deepEqual(quickPicks[0].items, [
    { label: "New File", description: "Create a new concept file", value: "New File" },
    { label: "concepts.cpt", description: "specs", value: "/workspace/gauge/specs/concepts.cpt" },
  ]);
  assert.equal(requests.length, 1);
  assert.equal(appliedEdits.length, 1);
  assert.equal(appliedEdits[0].replacements.length, 2);

  const sourceReplacement = appliedEdits[0].replacements.find(
    (entry) => entry.uri.fsPath === "/workspace/gauge/specs/example.spec",
  );
  assert.deepEqual({ ...sourceReplacement.range.start }, { line: 3, character: 0 });
  assert.deepEqual({ ...sourceReplacement.range.end }, { line: 5, character: 0 });
  assert.equal(sourceReplacement.newText, "* Shared checkout <user>\n");

  const conceptReplacement = appliedEdits[0].replacements.find(
    (entry) => entry.uri.fsPath === "/workspace/gauge/specs/concepts.cpt",
  );
  assert.equal(
    conceptReplacement.newText,
    [
      "# Existing",
      "* setup",
      "",
      "# Shared checkout <user>",
      "* Login as <user>",
      "* Buy item",
      "",
    ].join("\n"),
  );
});

test("ExtractConceptCommandProvider parameterizes selected inline tables", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const requests = [];
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Compare users",
    "|name|age|",
    "|Ada|42|",
    "* Done",
  ].join("\n"));
  const {
    appliedEdits,
    commands,
    vscode,
  } = createFakeVscode({
    conceptDocuments: {
      "/workspace/gauge/specs/concepts.cpt": "",
    },
    document,
    inputResponses: ["Shared comparison <table1>"],
    quickPickSelection: {
      label: "concepts.cpt",
      description: "specs",
      value: "/workspace/gauge/specs/concepts.cpt",
    },
    selection: {
      start: { line: 3, character: 0 },
      end: { line: 3, character: 15 },
    },
  });

  new ExtractConceptCommandProvider(createClients(requests), {
    pathModule: path.posix,
    vscode,
  });

  const command = commands.find((entry) => entry.command === "gauge.extract.concept");
  await command.handler();

  const sourceReplacement = appliedEdits[0].replacements.find(
    (entry) => entry.uri.fsPath === "/workspace/gauge/specs/example.spec",
  );
  assert.deepEqual({ ...sourceReplacement.range.start }, { line: 3, character: 0 });
  assert.deepEqual({ ...sourceReplacement.range.end }, { line: 6, character: 0 });
  assert.equal(
    sourceReplacement.newText,
    [
      "* Shared comparison",
      "|name|age|",
      "|Ada|42|",
      "",
    ].join("\n"),
  );

  const conceptReplacement = appliedEdits[0].replacements.find(
    (entry) => entry.uri.fsPath === "/workspace/gauge/specs/concepts.cpt",
  );
  assert.equal(
    conceptReplacement.newText,
    [
      "# Shared comparison <table1>",
      "* Compare users <table1>",
      "",
    ].join("\n"),
  );
});

test("ExtractConceptCommandProvider formats selected table parameters like Gauge", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const requests = [];
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Compare users",
    "|id|name|",
    "|--|----|",
    "|1 |hello <foo> |",
    "|2 |bar |",
    "* Done",
  ].join("\n"));
  const {
    appliedEdits,
    commands,
    vscode,
  } = createFakeVscode({
    conceptDocuments: {
      "/workspace/gauge/specs/concepts.cpt": "",
    },
    document,
    inputResponses: ["Shared comparison <table1>"],
    quickPickSelection: {
      label: "concepts.cpt",
      description: "specs",
      value: "/workspace/gauge/specs/concepts.cpt",
    },
    selection: {
      start: { line: 3, character: 0 },
      end: { line: 3, character: 15 },
    },
  });

  new ExtractConceptCommandProvider(createClients(requests), {
    pathModule: path.posix,
    vscode,
  });

  const command = commands.find((entry) => entry.command === "gauge.extract.concept");
  await command.handler();

  const sourceReplacement = appliedEdits[0].replacements.find(
    (entry) => entry.uri.fsPath === "/workspace/gauge/specs/example.spec",
  );
  assert.equal(
    sourceReplacement.newText,
    [
      "* Shared comparison",
      "",
      "   |id|name       |",
      "   |--|-----------|",
      "   |1 |hello <foo>|",
      "   |2 |bar        |",
      "",
    ].join("\n"),
  );

  const conceptReplacement = appliedEdits[0].replacements.find(
    (entry) => entry.uri.fsPath === "/workspace/gauge/specs/concepts.cpt",
  );
  assert.equal(
    conceptReplacement.newText,
    [
      "# Shared comparison <table1>",
      "* Compare users <table1>",
      "",
    ].join("\n"),
  );
});

test("ExtractConceptCommandProvider promotes table dynamic arguments to concept usage", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const requests = [];
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Compare users",
    "|name|role|",
    "|<user>|admin|",
    "",
  ].join("\n"));
  const {
    appliedEdits,
    commands,
    vscode,
  } = createFakeVscode({
    conceptDocuments: {
      "/workspace/gauge/specs/concepts.cpt": "",
    },
    document,
    inputResponses: ["Shared comparison"],
    quickPickSelection: {
      label: "concepts.cpt",
      description: "specs",
      value: "/workspace/gauge/specs/concepts.cpt",
    },
    selection: {
      start: { line: 3, character: 0 },
      end: { line: 3, character: 15 },
    },
  });

  new ExtractConceptCommandProvider(createClients(requests), {
    pathModule: path.posix,
    vscode,
  });

  const command = commands.find((entry) => entry.command === "gauge.extract.concept");
  await command.handler();

  const sourceReplacement = appliedEdits[0].replacements.find(
    (entry) => entry.uri.fsPath === "/workspace/gauge/specs/example.spec",
  );
  assert.equal(sourceReplacement.newText, "* Shared comparison <user>\n");

  const conceptReplacement = appliedEdits[0].replacements.find(
    (entry) => entry.uri.fsPath === "/workspace/gauge/specs/concepts.cpt",
  );
  assert.equal(
    conceptReplacement.newText,
    [
      "# Shared comparison <user>",
      "* Compare users",
      "|name|role|",
      "|<user>|admin|",
      "",
    ].join("\n"),
  );
});

test("ExtractConceptCommandProvider parameterizes selected static arguments", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const requests = [];
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Login as \"Ada\" with <role>",
    "",
  ].join("\n"));
  const {
    appliedEdits,
    commands,
    vscode,
  } = createFakeVscode({
    conceptDocuments: {
      "/workspace/gauge/specs/concepts.cpt": "",
    },
    document,
    inputResponses: ["Shared login \"Ada\" <role>"],
    quickPickSelection: {
      label: "concepts.cpt",
      description: "specs",
      value: "/workspace/gauge/specs/concepts.cpt",
    },
    selection: {
      start: { line: 3, character: 0 },
      end: { line: 3, character: 28 },
    },
  });

  new ExtractConceptCommandProvider(createClients(requests), {
    pathModule: path.posix,
    vscode,
  });

  const command = commands.find((entry) => entry.command === "gauge.extract.concept");
  await command.handler();

  const sourceReplacement = appliedEdits[0].replacements.find(
    (entry) => entry.uri.fsPath === "/workspace/gauge/specs/example.spec",
  );
  assert.equal(sourceReplacement.newText, "* Shared login \"Ada\" <role>\n");

  const conceptReplacement = appliedEdits[0].replacements.find(
    (entry) => entry.uri.fsPath === "/workspace/gauge/specs/concepts.cpt",
  );
  assert.equal(
    conceptReplacement.newText,
    [
      "# Shared login <Ada> <role>",
      "* Login as <Ada> with <role>",
      "",
    ].join("\n"),
  );
});

test("ExtractConceptCommandProvider creates a new concept file from the selected steps", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const requests = [];
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Login",
  ].join("\n"));
  const {
    appliedEdits,
    commands,
    vscode,
  } = createFakeVscode({
    conceptDocuments: {},
    document,
    inputResponses: ["Shared login", "specs/shared.cpt"],
    quickPickSelection: {
      label: "New File",
      description: "Create a new concept file",
      value: "New File",
    },
    selection: {
      start: { line: 3, character: 0 },
      end: { line: 3, character: 7 },
    },
  });

  new ExtractConceptCommandProvider(createClients(requests, []), {
    pathModule: path.posix,
    vscode,
  });

  const command = commands.find((entry) => entry.command === "gauge.extract.concept");
  await command.handler();

  assert.deepEqual(appliedEdits[0].createdFiles, [
    {
      uri: { fsPath: "/workspace/gauge/specs/shared.cpt" },
      options: { ignoreIfExists: true },
    },
  ]);
  const conceptReplacement = appliedEdits[0].replacements.find(
    (entry) => entry.uri.fsPath === "/workspace/gauge/specs/shared.cpt",
  );
  assert.equal(conceptReplacement.newText, "# Shared login\n* Login\n");
});

test("ExtractConceptCommandProvider rejects selections that include non-step text", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Login",
  ].join("\n"));
  const {
    appliedEdits,
    commands,
    errors,
    inputs,
    vscode,
  } = createFakeVscode({
    document,
    inputResponses: ["Unused concept"],
    selection: {
      start: { line: 2, character: 0 },
      end: { line: 3, character: 7 },
    },
  });

  new ExtractConceptCommandProvider(createClients([]), {
    pathModule: path.posix,
    vscode,
  });

  const command = commands.find((entry) => entry.command === "gauge.extract.concept");
  await command.handler();

  assert.deepEqual(errors, [
    "Cannot Extract to Concept, selected text contains invalid elements",
  ]);
  assert.deepEqual(inputs, []);
  assert.deepEqual(appliedEdits, []);
});

test("ExtractConceptCommandProvider rejects duplicate concept names", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const requests = [];
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Login",
  ].join("\n"));
  const {
    appliedEdits,
    commands,
    errors,
    vscode,
  } = createFakeVscode({
    conceptDocuments: {
      "/workspace/gauge/specs/concepts.cpt": "# Shared login\n* Login\n",
    },
    document,
    inputResponses: ["Shared login"],
    quickPickSelection: {
      label: "concepts.cpt",
      description: "specs",
      value: "/workspace/gauge/specs/concepts.cpt",
    },
    selection: {
      start: { line: 3, character: 0 },
      end: { line: 3, character: 7 },
    },
  });

  new ExtractConceptCommandProvider(createClients(requests), {
    pathModule: path.posix,
    vscode,
  });

  const command = commands.find((entry) => entry.command === "gauge.extract.concept");
  await command.handler();

  assert.deepEqual(errors, [
    "Concept `Shared login` already present",
  ]);
  assert.deepEqual(appliedEdits, []);
});

test("ExtractConceptCommandProvider rejects duplicate parameterized static concept names", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const requests = [];
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Login as \"Ada\" with <role>",
  ].join("\n"));
  const {
    appliedEdits,
    commands,
    errors,
    vscode,
  } = createFakeVscode({
    conceptDocuments: {
      "/workspace/gauge/specs/concepts.cpt": "# Shared login <Ada> <role>\n* Login\n",
    },
    document,
    inputResponses: ["Shared login \"Ada\" <role>"],
    quickPickSelection: {
      label: "concepts.cpt",
      description: "specs",
      value: "/workspace/gauge/specs/concepts.cpt",
    },
    selection: {
      start: { line: 3, character: 0 },
      end: { line: 3, character: 28 },
    },
  });

  new ExtractConceptCommandProvider(createClients(requests), {
    pathModule: path.posix,
    vscode,
  });

  const command = commands.find((entry) => entry.command === "gauge.extract.concept");
  await command.handler();

  assert.deepEqual(errors, [
    "Concept `Shared login \"Ada\" <role>` already present",
  ]);
  assert.deepEqual(appliedEdits, []);
});
