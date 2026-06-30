const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

function createDocument(text, fsPath = "/workspace/gauge/specs/example.spec", languageId = "gauge") {
  const lines = text.split("\n");
  return {
    fileName: fsPath,
    languageId,
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

function createClients(
  requests,
  conceptFiles = ["/workspace/gauge/specs/concepts.cpt"],
  expectedPath = "/workspace/gauge/specs/example.spec",
) {
  return {
    get(fsPath) {
      assert.equal(fsPath, expectedPath);
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

test("buildExtractSelection rejects indented step marker comments", () => {
  const { buildExtractSelection } = require("../src/extractConcept");
  const document = createDocument([
    "# Checkout",
    "  * Commented setup \"draft\" <ignored>",
    "* Real <item>",
  ].join("\n"));

  const extraction = buildExtractSelection(document, {
    start: { line: 1, character: 0 },
    end: { line: 1, character: 38 },
  });

  assert.equal(extraction, undefined);
});

test("ExtractConceptCommandProvider extracts selected steps from Markdown Gauge specs", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const requests = [];
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Login as <user>",
    "* Buy item",
    "",
  ].join("\n"), "/workspace/gauge/specs/example.md", "markdown");
  const {
    appliedEdits,
    commands,
    errors,
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

  new ExtractConceptCommandProvider(createClients(
    requests,
    ["/workspace/gauge/specs/concepts.cpt"],
    "/workspace/gauge/specs/example.md",
  ), {
    pathModule: path.posix,
    vscode,
  });

  const command = commands.find((entry) => entry.command === "gauge.extract.concept");
  assert.ok(command);

  await command.handler();

  assert.deepEqual(errors, []);
  assert.equal(requests.length, 1);
  const sourceReplacement = appliedEdits[0].replacements.find(
    (entry) => entry.uri.fsPath === "/workspace/gauge/specs/example.md",
  );
  assert.deepEqual({ ...sourceReplacement.range.start }, { line: 3, character: 0 });
  assert.deepEqual({ ...sourceReplacement.range.end }, { line: 5, character: 0 });
  assert.equal(sourceReplacement.newText, "* Shared checkout <user>\n");
});

test("buildExtractSelection rejects selections that start inside inline tables", () => {
  const { buildExtractSelection } = require("../src/extractConcept");
  const document = createDocument([
    "# Checkout",
    "* Login as <user>",
    "  | item | count |",
    "  | book | 1     |",
  ].join("\n"));

  const extraction = buildExtractSelection(document, {
    start: { line: 2, character: 0 },
    end: { line: 3, character: 18 },
  });

  assert.equal(extraction, undefined);
});

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

test("ExtractConceptCommandProvider extracts selected steps from concept files by extension", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const requests = [];
  const document = createDocument([
    "# Existing concept",
    "* Login as <user>",
    "* Buy item",
    "",
  ].join("\n"), "/workspace/gauge/specs/shared.cpt", "plaintext");
  const {
    appliedEdits,
    commands,
    inputs,
    vscode,
  } = createFakeVscode({
    conceptDocuments: {
      "/workspace/gauge/specs/concepts.cpt": "",
    },
    document,
    inputResponses: ["Shared checkout <user>"],
    quickPickSelection: {
      label: "concepts.cpt",
      description: "specs",
      value: "/workspace/gauge/specs/concepts.cpt",
    },
    selection: {
      start: { line: 1, character: 0 },
      end: { line: 2, character: 10 },
    },
  });

  new ExtractConceptCommandProvider(
    createClients(requests, ["/workspace/gauge/specs/concepts.cpt"], "/workspace/gauge/specs/shared.cpt"),
    {
      pathModule: path.posix,
      vscode,
    },
  );

  const command = commands.find((entry) => entry.command === "gauge.extract.concept");
  await command.handler();

  assert.equal(inputs[0].placeHolder, "Enter the concept name");
  assert.equal(requests.length, 1);
  assert.equal(appliedEdits.length, 1);

  const sourceReplacement = appliedEdits[0].replacements.find(
    (entry) => entry.uri.fsPath === "/workspace/gauge/specs/shared.cpt",
  );
  assert.deepEqual({ ...sourceReplacement.range.start }, { line: 1, character: 0 });
  assert.deepEqual({ ...sourceReplacement.range.end }, { line: 3, character: 0 });
  assert.equal(sourceReplacement.newText, "* Shared checkout <user>\n");
});

test("ExtractConceptCommandProvider extracts selected steps separated by blank lines", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const requests = [];
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Login",
    "",
    "* Logout",
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
    inputResponses: ["Shared flow"],
    quickPickSelection: {
      label: "concepts.cpt",
      description: "specs",
      value: "/workspace/gauge/specs/concepts.cpt",
    },
    selection: {
      start: { line: 3, character: 0 },
      end: { line: 5, character: 8 },
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
  assert.equal(sourceReplacement.newText, "* Shared flow\n");

  const conceptReplacement = appliedEdits[0].replacements.find(
    (entry) => entry.uri.fsPath === "/workspace/gauge/specs/concepts.cpt",
  );
  assert.equal(
    conceptReplacement.newText,
    [
      "# Shared flow",
      "* Login",
      "* Logout",
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

test("ExtractConceptCommandProvider parameterizes selected indented inline tables", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const requests = [];
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Compare users",
    "    |id|name|",
    "    |--|----|",
    "    |1 |Ada |",
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
  assert.deepEqual({ ...sourceReplacement.range.end }, { line: 7, character: 0 });
  assert.equal(
    sourceReplacement.newText,
    [
      "* Shared comparison",
      "",
      "   |id|name|",
      "   |--|----|",
      "   |1 |Ada |",
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

test("ExtractConceptCommandProvider ignores escaped table placeholders in concept names", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const requests = [];
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Compare users",
    "|name|age|",
    "|Ada |42 |",
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
    inputResponses: ["Shared comparison \\<table1>"],
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
  assert.equal(sourceReplacement.newText, "* Shared comparison \\<table1>\n");

  const conceptReplacement = appliedEdits[0].replacements.find(
    (entry) => entry.uri.fsPath === "/workspace/gauge/specs/concepts.cpt",
  );
  assert.equal(
    conceptReplacement.newText,
    [
      "# Shared comparison \\<table1>",
      "* Compare users",
      "|name|age|",
      "|Ada |42 |",
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

test("ExtractConceptCommandProvider formats escaped table pipes like Gauge", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const requests = [];
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Compare users",
    "|id|name\\|alias|",
    "|--|-----------|",
    "|1 |Ada\\|A     |",
    "|2 |Bob\\|B     |",
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
      "   |id|name\\|alias|",
      "   |--|-----------|",
      "   |1 |Ada\\|A     |",
      "   |2 |Bob\\|B     |",
      "",
    ].join("\n"),
  );
});

test("ExtractConceptCommandProvider treats even-backslash table pipes as separators", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const requests = [];
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Compare users",
    "|id|path\\\\|alias|",
    "|--|----|-----|",
    "|1 |C:\\\\|Ada  |",
    "|2 |D:\\\\|Bob  |",
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
      "   |id|path\\\\|alias|",
      "   |--|------|-----|",
      "   |1 |C:\\\\  |Ada  |",
      "   |2 |D:\\\\  |Bob  |",
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

test("ExtractConceptCommandProvider promotes escaped table dynamic arguments to concept usage", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const requests = [];
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Compare users",
    "|name|role|",
    "|<user \\> name>|admin|",
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
  assert.equal(sourceReplacement.newText, "* Shared comparison <user \\> name>\n");

  const conceptReplacement = appliedEdits[0].replacements.find(
    (entry) => entry.uri.fsPath === "/workspace/gauge/specs/concepts.cpt",
  );
  assert.equal(
    conceptReplacement.newText,
    [
      "# Shared comparison <user \\> name>",
      "* Compare users",
      "|name|role|",
      "|<user \\> name>|admin|",
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

test("ExtractConceptCommandProvider appends missing dynamic step parameters to concept usage", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const requests = [];
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Login as <user>",
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
    inputResponses: ["Shared login"],
    quickPickSelection: {
      label: "concepts.cpt",
      description: "specs",
      value: "/workspace/gauge/specs/concepts.cpt",
    },
    selection: {
      start: { line: 3, character: 0 },
      end: { line: 3, character: 17 },
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
  assert.equal(sourceReplacement.newText, "* Shared login <user>\n");

  const conceptReplacement = appliedEdits[0].replacements.find(
    (entry) => entry.uri.fsPath === "/workspace/gauge/specs/concepts.cpt",
  );
  assert.equal(
    conceptReplacement.newText,
    [
      "# Shared login <user>",
      "* Login as <user>",
      "",
    ].join("\n"),
  );
});

test("ExtractConceptCommandProvider parameterizes escaped static arguments", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const requests = [];
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Login as \"Ada \\\"The First\\\"\" with <role>",
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
    inputResponses: ["Shared login \"Ada \\\"The First\\\"\" <role>"],
    quickPickSelection: {
      label: "concepts.cpt",
      description: "specs",
      value: "/workspace/gauge/specs/concepts.cpt",
    },
    selection: {
      start: { line: 3, character: 0 },
      end: { line: 3, character: 45 },
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
  assert.equal(sourceReplacement.newText, "* Shared login \"Ada \\\"The First\\\"\" <role>\n");

  const conceptReplacement = appliedEdits[0].replacements.find(
    (entry) => entry.uri.fsPath === "/workspace/gauge/specs/concepts.cpt",
  );
  assert.equal(
    conceptReplacement.newText,
    [
      "# Shared login <Ada \\\"The First\\\"> <role>",
      "* Login as <Ada \\\"The First\\\"> with <role>",
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

test("ExtractConceptCommandProvider keeps rooted new concept paths inside the project", async () => {
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
    inputResponses: ["Shared login", "/specs/shared"],
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
});

test("ExtractConceptCommandProvider rejects new concept files without cpt extension", async () => {
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
    conceptDocuments: {},
    document,
    inputResponses: ["Shared login", "specs/shared.txt"],
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

  assert.deepEqual(appliedEdits, []);
  assert.deepEqual(errors, ["Concept file path must end with .cpt."]);
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

test("ExtractConceptCommandProvider ignores indented concept hash lines when checking duplicates", async () => {
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
      "/workspace/gauge/specs/concepts.cpt": "  # Shared login\n* Setup\n",
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

  assert.deepEqual(errors, []);
  assert.equal(appliedEdits.length, 1);

  const conceptReplacement = appliedEdits[0].replacements.find(
    (entry) => entry.uri.fsPath === "/workspace/gauge/specs/concepts.cpt",
  );
  assert.equal(
    conceptReplacement.newText,
    [
      "  # Shared login",
      "* Setup",
      "",
      "# Shared login",
      "* Login",
      "",
    ].join("\n"),
  );
});

test("ExtractConceptCommandProvider rejects duplicate legacy underline concept names", async () => {
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
      "/workspace/gauge/specs/concepts.cpt": [
        "Shared login",
        "============",
        "* Login",
        "",
      ].join("\n"),
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

test("ExtractConceptCommandProvider ignores unterminated legacy underline concept names", async () => {
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
      "/workspace/gauge/specs/concepts.cpt": [
        "Shared login",
        "============",
      ].join("\n"),
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

  assert.deepEqual(errors, []);
  assert.equal(appliedEdits.length, 1);

  const conceptReplacement = appliedEdits[0].replacements.find(
    (entry) => entry.uri.fsPath === "/workspace/gauge/specs/concepts.cpt",
  );
  assert.equal(
    conceptReplacement.newText,
    [
      "Shared login",
      "============",
      "",
      "# Shared login",
      "* Login",
      "",
    ].join("\n"),
  );
});

test("ExtractConceptCommandProvider rejects duplicate double-hash concept names", async () => {
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
      "/workspace/gauge/specs/concepts.cpt": "## Shared login\n* Login\n",
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
