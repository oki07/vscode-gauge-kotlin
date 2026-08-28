const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function trackCancellationSources(vscode, sources, onConstruct = () => {}) {
  vscode.CancellationTokenSource = class CancellationTokenSource {
    constructor() {
      this.cancelCalls = 0;
      this.disposeCalls = 0;
      this.token = { isCancellationRequested: false };
      sources.push(this);
      onConstruct(this);
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

test("buildExtractSelection accepts indented Gauge steps", () => {
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

  assert.deepEqual(extraction, {
    endLine: 1,
    lines: ["* Commented setup \"draft\" <ignored>"],
    startLine: 1,
    steps: [
      {
        tableLines: [],
        text: "* Commented setup \"draft\" <ignored>",
      },
    ],
  });
});

test("buildExtractSelection includes docstring blocks after selected Gauge steps", () => {
  const { buildExtractSelection } = require("../src/extractConcept");
  const document = createDocument([
    "# Checkout",
    "## Success",
    "* Send payload",
    "\"\"\"",
    "hello world",
    "from multiline",
    "\"\"\"",
    "* Continue",
  ].join("\n"));

  const extraction = buildExtractSelection(document, {
    start: { line: 2, character: 0 },
    end: { line: 2, character: 14 },
  });

  assert.deepEqual(extraction, {
    endLine: 6,
    lines: [
      "* Send payload",
      "\"\"\"",
      "hello world",
      "from multiline",
      "\"\"\"",
    ],
    startLine: 2,
    steps: [
      {
        docStringLines: [
          "\"\"\"",
          "hello world",
          "from multiline",
          "\"\"\"",
        ],
        tableLines: [],
        text: "* Send payload",
      },
    ],
  });
});

test("buildExtractSelection accepts multiline Gauge steps when project allows them", () => {
  const { buildExtractSelection } = require("../src/extractConcept");
  const document = createDocument([
    "# Checkout",
    "## Success",
    "* Pay with",
    "card <amount>",
    "* Continue",
  ].join("\n"));

  const extraction = buildExtractSelection(document, {
    start: { line: 2, character: 0 },
    end: { line: 3, character: 13 },
  }, { allowMultilineStep: true });

  assert.deepEqual(extraction, {
    endLine: 3,
    lines: [
      "* Pay with card <amount>",
    ],
    startLine: 2,
    steps: [
      {
        tableLines: [],
        text: "* Pay with card <amount>",
      },
    ],
  });
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

test("ExtractConceptCommandProvider extracts selected steps from spec files by extension", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const requests = [];
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Login as <user>",
    "* Buy item",
    "",
  ].join("\n"), "/workspace/gauge/specs/example.spec", "plaintext");
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

  new ExtractConceptCommandProvider(createClients(requests), {
    pathModule: path.posix,
    vscode,
  });

  const command = commands.find((entry) => entry.command === "gauge.extract.concept");
  assert.ok(command);

  await command.handler();

  assert.deepEqual(errors, []);
  assert.equal(requests.length, 1);
  const sourceReplacement = appliedEdits[0].replacements.find(
    (entry) => entry.uri.fsPath === "/workspace/gauge/specs/example.spec",
  );
  assert.deepEqual({ ...sourceReplacement.range.start }, { line: 3, character: 0 });
  assert.deepEqual({ ...sourceReplacement.range.end }, { line: 5, character: 0 });
  assert.equal(sourceReplacement.newText, "* Shared checkout <user>\n");
});

test("ExtractConceptCommandProvider rejects Gauge documents without a project before prompting", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Login",
  ].join("\n"), "/outside/specs/example.spec", "gauge");
  const {
    appliedEdits,
    commands,
    errors,
    inputs,
    quickPicks,
    vscode,
  } = createFakeVscode({
    document,
    inputResponses: ["Shared login"],
    selection: {
      start: { line: 3, character: 0 },
      end: { line: 3, character: 7 },
    },
  });

  new ExtractConceptCommandProvider({
    get(fsPath) {
      assert.equal(fsPath, "/outside/specs/example.spec");
      return undefined;
    },
  }, {
    pathModule: path.posix,
    vscode,
  });

  const command = commands.find((entry) => entry.command === "gauge.extract.concept");
  await command.handler();

  assert.deepEqual(errors, ["Cannot find Gauge document for extract to concept."]);
  assert.deepEqual(inputs, []);
  assert.deepEqual(quickPicks, []);
  assert.deepEqual(appliedEdits, []);
});

test("buildExtractSelection expands inline table selections to their owning Gauge step", () => {
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

  assert.deepEqual(extraction, {
    endLine: 3,
    lines: [
      "* Login as <user>",
      "| item | count |",
      "| book | 1     |",
    ],
    startLine: 1,
    steps: [
      {
        tableLines: [
          "| item | count |",
          "| book | 1     |",
        ],
        text: "* Login as <user>",
      },
    ],
  });
});

// Gauge's lexer emits no token for a blank line after a step, so the table still
// attaches to it: src/stepDiagnostics.js inlineTableLineAfterStep records the
// same rule, verified against parser.SpecParser.Parse. Extract to Concept
// required the table on the very next line, so a blank line made it drop the
// table and produce a concept step with no argument.
test("buildExtractSelection keeps a table separated from its step by a blank line", () => {
  const { buildExtractSelection } = require("../src/extractConcept");
  const document = createDocument([
    "# Checkout",
    "* Login as <user>",
    "",
    "  | item | count |",
    "  | book | 1     |",
  ].join("\n"));

  const extraction = buildExtractSelection(document, {
    start: { line: 1, character: 0 },
    end: { line: 4, character: 18 },
  });

  assert.deepEqual(extraction.steps, [
    {
      tableLines: [
        "| item | count |",
        "| book | 1     |",
      ],
      text: "* Login as <user>",
    },
  ]);
  assert.equal(extraction.endLine, 4);
});

test("buildExtractSelection rejects table selections without an owning Gauge step", () => {
  const { buildExtractSelection } = require("../src/extractConcept");
  const document = createDocument([
    "# Checkout",
    "| item | count |",
    "| book | 1     |",
  ].join("\n"));

  const extraction = buildExtractSelection(document, {
    start: { line: 1, character: 0 },
    end: { line: 2, character: 18 },
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

test("ExtractConceptCommandProvider extracts multiline Gauge steps when project allows them", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const requests = [];
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Pay with",
    "card <amount>",
    "* Continue",
    "",
  ].join("\n"));
  const {
    appliedEdits,
    commands,
    errors,
    inputs,
    vscode,
  } = createFakeVscode({
    conceptDocuments: {
      "/workspace/gauge/specs/concepts.cpt": "# Existing\n* setup\n",
    },
    document,
    inputResponses: ["Shared checkout <amount>"],
    quickPickSelection: {
      label: "concepts.cpt",
      description: "specs",
      value: "/workspace/gauge/specs/concepts.cpt",
    },
    selection: {
      start: { line: 3, character: 0 },
      end: { line: 4, character: 13 },
    },
  });

  new ExtractConceptCommandProvider(createClients(requests), {
    fileSystem: {
      readFileSync(filename, encoding) {
        assert.equal(filename, "/workspace/gauge/env/default/default.properties");
        assert.equal(encoding, "utf8");
        return "allow_multiline_step = true\n";
      },
    },
    pathModule: path.posix,
    vscode,
  });

  const command = commands.find((entry) => entry.command === "gauge.extract.concept");
  await command.handler();

  assert.deepEqual(errors, []);
  assert.equal(inputs[0].prompt, "Available parameters: <amount>");
  assert.equal(appliedEdits.length, 1);

  const sourceReplacement = appliedEdits[0].replacements.find(
    (entry) => entry.uri.fsPath === "/workspace/gauge/specs/example.spec",
  );
  assert.deepEqual({ ...sourceReplacement.range.start }, { line: 3, character: 0 });
  assert.deepEqual({ ...sourceReplacement.range.end }, { line: 5, character: 0 });
  assert.equal(sourceReplacement.newText, "* Shared checkout <amount>\n");

  const conceptReplacement = appliedEdits[0].replacements.find(
    (entry) => entry.uri.fsPath === "/workspace/gauge/specs/concepts.cpt",
  );
  assert.equal(
    conceptReplacement.newText,
    [
      "# Existing",
      "* setup",
      "",
      "# Shared checkout <amount>",
      "* Pay with card <amount>",
      "",
    ].join("\n"),
  );
});

test("ExtractConceptCommandProvider extracts docstring blocks with selected Gauge steps", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const requests = [];
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Send payload",
    "\"\"\"",
    "hello world",
    "from multiline",
    "\"\"\"",
    "* Continue",
    "",
  ].join("\n"));
  const {
    appliedEdits,
    commands,
    vscode,
  } = createFakeVscode({
    conceptDocuments: {
      "/workspace/gauge/specs/concepts.cpt": "# Existing\n* setup\n",
    },
    document,
    inputResponses: ["Shared payload"],
    quickPickSelection: {
      label: "concepts.cpt",
      description: "specs",
      value: "/workspace/gauge/specs/concepts.cpt",
    },
    selection: {
      start: { line: 3, character: 0 },
      end: { line: 3, character: 14 },
    },
  });

  new ExtractConceptCommandProvider(createClients(requests), {
    pathModule: path.posix,
    vscode,
  });

  const command = commands.find((entry) => entry.command === "gauge.extract.concept");
  await command.handler();

  assert.equal(appliedEdits.length, 1);
  assert.equal(appliedEdits[0].replacements.length, 2);

  const sourceReplacement = appliedEdits[0].replacements.find(
    (entry) => entry.uri.fsPath === "/workspace/gauge/specs/example.spec",
  );
  assert.deepEqual({ ...sourceReplacement.range.start }, { line: 3, character: 0 });
  assert.deepEqual({ ...sourceReplacement.range.end }, { line: 8, character: 0 });
  assert.equal(sourceReplacement.newText, "* Shared payload\n");

  const conceptReplacement = appliedEdits[0].replacements.find(
    (entry) => entry.uri.fsPath === "/workspace/gauge/specs/concepts.cpt",
  );
  assert.equal(
    conceptReplacement.newText,
    [
      "# Existing",
      "* setup",
      "",
      "# Shared payload",
      "* Send payload",
      "\"\"\"",
      "hello world",
      "from multiline",
      "\"\"\"",
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

test("ExtractConceptCommandProvider extracts selected steps from gauge-concept documents by language id", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const requests = [];
  const document = createDocument([
    "# Existing concept",
    "* Login as <user>",
    "* Buy item",
    "",
  ].join("\n"), "/workspace/gauge/specs/shared", "gauge-concept");
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
    createClients(requests, ["/workspace/gauge/specs/concepts.cpt"], "/workspace/gauge/specs/shared"),
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
    (entry) => entry.uri.fsPath === "/workspace/gauge/specs/shared",
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

test("ExtractConceptCommandProvider offers selected step arguments while naming concepts", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const requests = [];
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Login as <user> with \"password\"",
    "* Compare users",
    "|name|age|",
    "|--|---|",
    "|Ada |42 |",
    "",
  ].join("\n"));
  const {
    commands,
    inputs,
    vscode,
  } = createFakeVscode({
    conceptDocuments: {
      "/workspace/gauge/specs/concepts.cpt": "",
    },
    document,
    inputResponses: ["Shared flow <user> \"password\" <table1>"],
    quickPickSelection: {
      label: "concepts.cpt",
      description: "specs",
      value: "/workspace/gauge/specs/concepts.cpt",
    },
    selection: {
      start: { line: 3, character: 0 },
      end: { line: 7, character: 9 },
    },
  });

  new ExtractConceptCommandProvider(createClients(requests), {
    pathModule: path.posix,
    vscode,
  });

  const command = commands.find((entry) => entry.command === "gauge.extract.concept");
  await command.handler();

  assert.equal(inputs[0].placeHolder, "Enter the concept name");
  assert.equal(inputs[0].prompt, "Available parameters: <user>, \"password\", <table1>");
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

test("ExtractConceptCommandProvider formats table parameters without closing pipes", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const requests = [];
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Compare users",
    "|id|name",
    "|--|----",
    "|1 |hello <foo>",
    "|2 |bar",
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

// normalizeConceptFilePath strips a leading root to force the path
// project-relative, but pathModule.join then resolves "..", so "../evil.cpt"
// landed outside the Gauge project. Gauge only reads concepts under the project
// (references/gauge/util/util.go), so such a file is both invisible to Gauge and
// written somewhere the user did not ask for.
test("ExtractConceptCommandProvider keeps a new concept file inside the project", async () => {
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
    inputResponses: ["Shared login", "../../outside.cpt"],
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
  assert.deepEqual(errors, ["Concept file path must stay inside the Gauge project."]);
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

// The heading actually written appends the step's dynamic parameters, so
// extracting "Shared login" from "* Login as <user>" writes
// "# Shared login <user>". The guard compared the name before that append, so
// the same extraction a second time saw no match and wrote a second
// "# Shared login <user>" - which Gauge rejects with "Duplicate concept
// definition found" (references/gauge/parser).
test("ExtractConceptCommandProvider rejects a duplicate once parameters are appended", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const requests = [];
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Login as <user>",
  ].join("\n"));
  const {
    appliedEdits,
    commands,
    errors,
    vscode,
  } = createFakeVscode({
    conceptDocuments: {
      "/workspace/gauge/specs/concepts.cpt": "# Shared login <user>\n* Login as <user>\n",
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

  assert.deepEqual(errors, [
    "Concept `Shared login` already present",
  ]);
  assert.deepEqual(appliedEdits, []);
});

test("ExtractConceptCommandProvider rejects indented duplicate concept hash lines", async () => {
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

  assert.deepEqual(errors, [
    "Concept `Shared login` already present",
  ]);
  assert.deepEqual(appliedEdits, []);
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

test("ExtractConceptCommandProvider ignores retained calls after disposal", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Login",
  ].join("\n"));
  const fake = createFakeVscode({
    document,
    selection: {
      start: { line: 3, character: 0 },
      end: { line: 3, character: 7 },
    },
  });
  let clientLookups = 0;
  let registrationDisposeCalls = 0;
  fake.vscode.commands.registerCommand = (command, handler) => {
    fake.commands.push({ command, handler });
    return {
      dispose() {
        registrationDisposeCalls += 1;
      },
    };
  };
  const provider = new ExtractConceptCommandProvider({
    get() {
      clientLookups += 1;
      return undefined;
    },
  }, {
    pathModule: path.posix,
    vscode: fake.vscode,
  });
  const handler = fake.commands.find(
    (entry) => entry.command === "gauge.extract.concept",
  ).handler;

  provider.dispose();
  provider.dispose();
  const outcomes = await Promise.allSettled([
    handler(),
    provider.extractConcept(),
  ]);

  assert.deepEqual({
    activeOperations: provider.activeOperations && provider.activeOperations.size,
    appliedEdits: fake.appliedEdits.length,
    clientLookups,
    errors: fake.errors,
    information: fake.information,
    inputs: fake.inputs.length,
    outcomes,
    quickPicks: fake.quickPicks.length,
    registrationDisposeCalls,
  }, {
    activeOperations: 0,
    appliedEdits: 0,
    clientLookups: 0,
    errors: [],
    information: [],
    inputs: 0,
    outcomes: [
      { status: "fulfilled", value: undefined },
      { status: "fulfilled", value: undefined },
    ],
    quickPicks: 0,
    registrationDisposeCalls: 1,
  });
});

test("ExtractConceptCommandProvider settles a pending concept name prompt on disposal", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Login",
  ].join("\n"));
  const fake = createFakeVscode({
    document,
    selection: {
      start: { line: 3, character: 0 },
      end: { line: 3, character: 7 },
    },
  });
  const prompt = deferred();
  const promptEntered = deferred();
  let requestCalls = 0;
  fake.vscode.window.showInputBox = (options) => {
    fake.inputs.push(options);
    promptEntered.resolve();
    return prompt.promise;
  };
  const provider = new ExtractConceptCommandProvider(createClients({
    push() {
      requestCalls += 1;
    },
  }), {
    pathModule: path.posix,
    vscode: fake.vscode,
  });
  const handler = fake.commands.find(
    (entry) => entry.command === "gauge.extract.concept",
  ).handler;
  let settled = false;
  const pending = handler().then((value) => {
    settled = true;
    return value;
  });

  await promptEntered.promise;
  provider.dispose();
  await nextTurn();
  const snapshot = {
    activeOperations: provider.activeOperations && provider.activeOperations.size,
    requestCalls,
    settled,
  };
  prompt.resolve("Shared login");
  const outcome = await Promise.allSettled([pending]);
  await nextTurn();

  assert.deepEqual({
    ...snapshot,
    appliedEdits: fake.appliedEdits.length,
    errors: fake.errors,
    information: fake.information,
    outcome,
    quickPicks: fake.quickPicks.length,
    requestCallsAfterSettlement: requestCalls,
  }, {
    activeOperations: 0,
    appliedEdits: 0,
    errors: [],
    information: [],
    outcome: [{ status: "fulfilled", value: undefined }],
    quickPicks: 0,
    requestCalls: 0,
    requestCallsAfterSettlement: 0,
    settled: true,
  });
});

test("ExtractConceptCommandProvider cancels a pending implementation-file request on disposal", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Login",
  ].join("\n"));
  const fake = createFakeVscode({
    document,
    inputResponses: ["Shared login"],
    selection: {
      start: { line: 3, character: 0 },
      end: { line: 3, character: 7 },
    },
  });
  const request = deferred();
  const requestEntered = deferred();
  const sources = [];
  trackCancellationSources(fake.vscode, sources);
  const requests = [];
  const provider = new ExtractConceptCommandProvider({
    get() {
      return {
        client: {
          sendRequest(method, params, token) {
            requests.push({ method, params, token });
            requestEntered.resolve();
            return request.promise;
          },
        },
        project: {
          root() {
            return "/workspace/gauge";
          },
        },
      };
    },
  }, {
    pathModule: path.posix,
    vscode: fake.vscode,
  });
  const handler = fake.commands.find(
    (entry) => entry.command === "gauge.extract.concept",
  ).handler;
  let settled = false;
  const pending = handler().then((value) => {
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
  request.reject(new Error("disposed extract request failed"));
  const outcome = await Promise.allSettled([pending]);
  await nextTurn();

  assert.deepEqual({
    ...snapshot,
    appliedEdits: fake.appliedEdits.length,
    errors: fake.errors,
    information: fake.information,
    outcome,
    quickPicks: fake.quickPicks.length,
    requestCount: requests.length,
    tokenCancelled: sources[0].token.isCancellationRequested,
  }, {
    activeOperations: 0,
    appliedEdits: 0,
    cancelCalls: 1,
    disposeCalls: 1,
    errors: [],
    information: [],
    outcome: [{ status: "fulfilled", value: undefined }],
    quickPicks: 0,
    requestCount: 1,
    settled: true,
    tokenCancelled: true,
  });
});

test("ExtractConceptCommandProvider does not start apply after disposal during edit preparation", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const conceptPath = "/workspace/gauge/specs/concepts.cpt";
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Login",
  ].join("\n"));
  const fake = createFakeVscode({
    document,
    inputResponses: ["Shared login"],
    quickPickSelection: {
      label: "concepts.cpt",
      description: "specs",
      value: conceptPath,
    },
    selection: {
      start: { line: 3, character: 0 },
      end: { line: 3, character: 7 },
    },
  });
  const secondOpen = deferred();
  const secondOpenEntered = deferred();
  let openCalls = 0;
  fake.vscode.workspace.openTextDocument = () => {
    openCalls += 1;
    if (openCalls === 1) {
      return Promise.resolve(createDocument("# Existing\n* Setup\n", conceptPath, "gauge-concept"));
    }
    secondOpenEntered.resolve();
    return secondOpen.promise;
  };
  let applyCalls = 0;
  let factoryCalls = 0;
  const provider = new ExtractConceptCommandProvider(createClients([], [conceptPath]), {
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
    (entry) => entry.command === "gauge.extract.concept",
  ).handler;
  let settled = false;
  const pending = handler().then((value) => {
    settled = true;
    return value;
  });

  await secondOpenEntered.promise;
  provider.dispose();
  await nextTurn();
  const snapshot = {
    activeOperations: provider.activeOperations && provider.activeOperations.size,
    applyCalls,
    factoryCalls,
    settled,
  };
  secondOpen.resolve(createDocument("# Existing\n* Setup\n", conceptPath, "gauge-concept"));
  const outcome = await Promise.allSettled([pending]);
  await nextTurn();

  assert.deepEqual({
    ...snapshot,
    applyCallsAfterSettlement: applyCalls,
    errors: fake.errors,
    factoryCallsAfterSettlement: factoryCalls,
    information: fake.information,
    openCalls,
    outcome,
  }, {
    activeOperations: 0,
    applyCalls: 0,
    applyCallsAfterSettlement: 0,
    errors: [],
    factoryCalls: 0,
    factoryCallsAfterSettlement: 0,
    information: [],
    openCalls: 2,
    outcome: [{ status: "fulfilled", value: undefined }],
    settled: true,
  });
});

test("ExtractConceptCommandProvider detaches an apply already started during disposal", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");

  for (const settlement of ["true", "false", "reject"]) {
    const conceptPath = "/workspace/gauge/specs/concepts.cpt";
    const document = createDocument([
      "# Checkout",
      "",
      "## Success",
      "* Login",
    ].join("\n"));
    const fake = createFakeVscode({
      conceptDocuments: {
        [conceptPath]: "# Existing\n* Setup\n",
      },
      document,
      inputResponses: ["Shared login"],
      quickPickSelection: {
        label: "concepts.cpt",
        description: "specs",
        value: conceptPath,
      },
      selection: {
        start: { line: 3, character: 0 },
        end: { line: 3, character: 7 },
      },
    });
    const apply = deferred();
    const applyEntered = deferred();
    let applyCalls = 0;
    const provider = new ExtractConceptCommandProvider(createClients([], [conceptPath]), {
      pathModule: path.posix,
      vscode: fake.vscode,
      workspaceEditorFactory() {
        return {
          applyChanges() {
            applyCalls += 1;
            applyEntered.resolve();
            return apply.promise;
          },
        };
      },
    });
    const handler = fake.commands.find(
      (entry) => entry.command === "gauge.extract.concept",
    ).handler;
    let settled = false;
    const pending = handler().then((value) => {
      settled = true;
      return value;
    });

    await applyEntered.promise;
    provider.dispose();
    await nextTurn();
    const snapshot = {
      activeOperations: provider.activeOperations && provider.activeOperations.size,
      applyCalls,
      settled,
    };
    if (settlement === "true") {
      apply.resolve(true);
    } else if (settlement === "false") {
      apply.resolve(false);
    } else {
      apply.reject(new Error("disposed apply failed"));
    }
    const outcome = await Promise.allSettled([pending]);
    await nextTurn();

    assert.deepEqual({
      ...snapshot,
      applyCallsAfterSettlement: applyCalls,
      errors: fake.errors,
      information: fake.information,
      outcome,
      settlement,
    }, {
      activeOperations: 0,
      applyCalls: 1,
      applyCallsAfterSettlement: 1,
      errors: [],
      information: [],
      outcome: [{ status: "fulfilled", value: undefined }],
      settled: true,
      settlement,
    });
  }
});

test("ExtractConceptCommandProvider releases live request sources and preserves live failures", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");

  for (const settlement of ["success", "reject"]) {
    const conceptPath = "/workspace/gauge/specs/concepts.cpt";
    const document = createDocument([
      "# Checkout",
      "",
      "## Success",
      "* Login",
    ].join("\n"));
    const fake = createFakeVscode({
      conceptDocuments: {
        [conceptPath]: "# Existing\n* Setup\n",
      },
      document,
      inputResponses: ["Shared login"],
      quickPickSelection: {
        label: "concepts.cpt",
        description: "specs",
        value: conceptPath,
      },
      selection: {
        start: { line: 3, character: 0 },
        end: { line: 3, character: 7 },
      },
    });
    const sources = [];
    trackCancellationSources(fake.vscode, sources);
    const requestError = new Error("live extract request failed");
    const requests = [];
    const provider = new ExtractConceptCommandProvider({
      get() {
        return {
          client: {
            sendRequest(method, params, token) {
              requests.push({ method, params, token });
              if (settlement === "reject") {
                return Promise.reject(requestError);
              }
              return Promise.resolve([conceptPath]);
            },
          },
          project: {
            root() {
              return "/workspace/gauge";
            },
          },
        };
      },
    }, {
      pathModule: path.posix,
      vscode: fake.vscode,
    });
    const handler = fake.commands.find(
      (entry) => entry.command === "gauge.extract.concept",
    ).handler;

    const outcome = await Promise.allSettled([handler()]);

    assert.deepEqual({
      activeOperations: provider.activeOperations.size,
      appliedEdits: fake.appliedEdits.length,
      cancelCalls: sources[0].cancelCalls,
      disposeCalls: sources[0].disposeCalls,
      errors: fake.errors,
      information: fake.information,
      outcome,
      quickPicks: fake.quickPicks.length,
      requestCount: requests.length,
      settlement,
      token: requests[0].token,
    }, {
      activeOperations: 0,
      appliedEdits: settlement === "success" ? 1 : 0,
      cancelCalls: 0,
      disposeCalls: 1,
      errors: settlement === "reject" ? [requestError.message] : [],
      information: settlement === "success" ? ["Concept extracted."] : [],
      outcome: [{ status: "fulfilled", value: undefined }],
      quickPicks: settlement === "success" ? 1 : 0,
      requestCount: 1,
      settlement,
      token: sources[0].token,
    });
  }
});

test("ExtractConceptCommandProvider normalizes synchronous disposal at operation boundaries", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");

  for (const boundary of ["request", "factory", "apply"]) {
    const conceptPath = "/workspace/gauge/specs/concepts.cpt";
    const document = createDocument([
      "# Checkout",
      "",
      "## Success",
      "* Login",
    ].join("\n"));
    const fake = createFakeVscode({
      conceptDocuments: {
        [conceptPath]: "# Existing\n* Setup\n",
      },
      document,
      inputResponses: ["Shared login"],
      quickPickSelection: {
        label: "concepts.cpt",
        description: "specs",
        value: conceptPath,
      },
      selection: {
        start: { line: 3, character: 0 },
        end: { line: 3, character: 7 },
      },
    });
    const sources = [];
    trackCancellationSources(fake.vscode, sources);
    const boundaryError = new Error(`disposed during ${boundary}`);
    let applyCalls = 0;
    let factoryCalls = 0;
    let provider;
    const clients = {
      get() {
        return {
          client: {
            sendRequest() {
              if (boundary === "request") {
                provider.dispose();
                return Promise.reject(boundaryError);
              }
              return Promise.resolve([conceptPath]);
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
    const options = {
      pathModule: path.posix,
      vscode: fake.vscode,
    };
    if (boundary === "factory") {
      options.workspaceEditorFactory = () => {
        factoryCalls += 1;
        provider.dispose();
        return {
          applyChanges() {
            applyCalls += 1;
            return Promise.resolve(true);
          },
        };
      };
    }
    provider = new ExtractConceptCommandProvider(clients, options);
    if (boundary === "apply") {
      fake.vscode.workspace.applyEdit = () => {
        applyCalls += 1;
        provider.dispose();
        return Promise.reject(boundaryError);
      };
    }
    const handler = fake.commands.find(
      (entry) => entry.command === "gauge.extract.concept",
    ).handler;

    const outcome = await Promise.allSettled([handler()]);
    await nextTurn();

    assert.deepEqual({
      activeOperations: provider.activeOperations.size,
      appliedEdits: fake.appliedEdits.length,
      applyCalls,
      boundary,
      cancelCalls: sources[0].cancelCalls,
      disposeCalls: sources[0].disposeCalls,
      errors: fake.errors,
      factoryCalls,
      information: fake.information,
      outcome,
    }, {
      activeOperations: 0,
      appliedEdits: 0,
      applyCalls: boundary === "apply" ? 1 : 0,
      boundary,
      cancelCalls: boundary === "request" ? 1 : 0,
      disposeCalls: 1,
      errors: [],
      factoryCalls: boundary === "factory" ? 1 : 0,
      information: [],
      outcome: [{ status: "fulfilled", value: undefined }],
    });
  }
});

test("ExtractConceptCommandProvider cancels concurrent operations exactly once on disposal", async () => {
  const { ExtractConceptCommandProvider } = require("../src/extractConcept");
  const document = createDocument([
    "# Checkout",
    "",
    "## Success",
    "* Login",
  ].join("\n"));
  const fake = createFakeVscode({
    document,
    inputResponses: ["Shared login one", "Shared login two"],
    selection: {
      start: { line: 3, character: 0 },
      end: { line: 3, character: 7 },
    },
  });
  const sources = [];
  trackCancellationSources(fake.vscode, sources);
  const requestsEntered = deferred();
  const requestGates = [deferred(), deferred()];
  let requestCalls = 0;
  let registrationDisposeCalls = 0;
  fake.vscode.commands.registerCommand = (command, handler) => {
    fake.commands.push({ command, handler });
    return {
      dispose() {
        registrationDisposeCalls += 1;
      },
    };
  };
  const provider = new ExtractConceptCommandProvider({
    get() {
      return {
        client: {
          sendRequest() {
            const gate = requestGates[requestCalls];
            requestCalls += 1;
            if (requestCalls === requestGates.length) {
              requestsEntered.resolve();
            }
            return gate.promise;
          },
        },
        project: {
          root() {
            return "/workspace/gauge";
          },
        },
      };
    },
  }, {
    pathModule: path.posix,
    vscode: fake.vscode,
  });
  const handler = fake.commands.find(
    (entry) => entry.command === "gauge.extract.concept",
  ).handler;
  let settled = 0;
  const pending = [handler(), handler()].map((promise) => promise.then((value) => {
    settled += 1;
    return value;
  }));

  await requestsEntered.promise;
  provider.dispose();
  provider.dispose();
  await nextTurn();
  const snapshot = {
    activeOperations: provider.activeOperations.size,
    registrationDisposeCalls,
    settled,
    sources: sources.map((source) => ({
      cancelCalls: source.cancelCalls,
      disposeCalls: source.disposeCalls,
      tokenCancelled: source.token.isCancellationRequested,
    })),
  };
  requestGates[0].resolve([]);
  requestGates[1].reject(new Error("disposed concurrent request failed"));
  const outcomes = await Promise.allSettled(pending);
  await nextTurn();

  assert.deepEqual({
    ...snapshot,
    appliedEdits: fake.appliedEdits.length,
    errors: fake.errors,
    information: fake.information,
    outcomes,
    quickPicks: fake.quickPicks.length,
    requestCalls,
  }, {
    activeOperations: 0,
    appliedEdits: 0,
    errors: [],
    information: [],
    outcomes: [
      { status: "fulfilled", value: undefined },
      { status: "fulfilled", value: undefined },
    ],
    quickPicks: 0,
    registrationDisposeCalls: 1,
    requestCalls: 2,
    settled: 2,
    sources: [
      { cancelCalls: 1, disposeCalls: 1, tokenCancelled: true },
      { cancelCalls: 1, disposeCalls: 1, tokenCancelled: true },
    ],
  });
});
