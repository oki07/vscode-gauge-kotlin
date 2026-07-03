const assert = require("node:assert/strict");
const test = require("node:test");

function createFakeVscode(textDocuments) {
  return {
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
    WorkspaceEdit: class WorkspaceEdit {
      constructor() {
        this.replacements = [];
      }

      replace(uri, range, newText) {
        this.replacements.push({ uri, range, newText });
      }
    },
    Uri: {
      parse(value) {
        return {
          fsPath: value.startsWith("file://") ? value.slice("file://".length) : value,
          toString() {
            return value;
          },
        };
      },
    },
    workspace: {
      textDocuments,
    },
  };
}

function createRegistrationVscode() {
  let registration;
  return {
    get registration() {
      return registration;
    },
    languages: {
      registerRenameProvider(selector, provider) {
        registration = { selector, provider };
        return { dispose() {} };
      },
    },
  };
}

function createDocument(text, languageId, fsPath) {
  const lines = text.split(/\r?\n/);
  return {
    languageId,
    uri: {
      fsPath,
      toString() {
        return `file://${fsPath}`;
      },
    },
    getText() {
      return text;
    },
    lineAt(line) {
      return { text: lines[line] || "" };
    },
  };
}

test("GaugeRenameProvider delegates Gauge renames to the Gauge language server", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Checkout",
    "* Pay with <amount>",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const requests = [];
  const client = {
    sendRequest(method, params, token) {
      requests.push({ method, params, token });
      return {
        changes: {
          "file:///workspace/gauge/specs/checkout.spec": [
            {
              range: {
                start: { line: 1, character: 0 },
                end: { line: 1, character: 19 },
              },
              newText: "* Pay with \"value\"",
            },
          ],
          "file:///workspace/gauge/src/test/kotlin/Steps.kt": [
            {
              range: {
                start: { line: 2, character: 7 },
                end: { line: 2, character: 24 },
              },
              newText: "Pay with <value>",
            },
          ],
        },
      };
    },
  };
  const clientsMap = {
    get(file) {
      assert.equal(file, "/workspace/gauge/specs/checkout.spec");
      return { client };
    },
  };
  const vscode = createFakeVscode([specDocument]);
  const provider = new GaugeRenameProvider({ clientsMap, vscode });

  const edit = await provider.provideRenameEdits(
    specDocument,
    new vscode.Position(1, 4),
    "Pay with <value>",
  );

  assert.deepEqual(requests, [
    {
      method: "textDocument/rename",
      params: {
        textDocument: { uri: "file:///workspace/gauge/specs/checkout.spec" },
        position: { line: 1, character: 4 },
        newName: "Pay with <value>",
      },
      token: undefined,
    },
  ]);
  assert.deepEqual(
    edit.replacements.map((replacement) => ({
      file: replacement.uri.fsPath,
      range: {
        start: { ...replacement.range.start },
        end: { ...replacement.range.end },
      },
      newText: replacement.newText,
    })),
    [
      {
        file: "/workspace/gauge/specs/checkout.spec",
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 19 },
        },
        newText: "* Pay with \"value\"",
      },
      {
        file: "/workspace/gauge/src/test/kotlin/Steps.kt",
        range: {
          start: { line: 2, character: 7 },
          end: { line: 2, character: 24 },
        },
        newText: "Pay with <value>",
      },
    ],
  );
});

test("GaugeRenameProvider augments language server Gauge renames with Kotlin Step annotations", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Checkout",
    "* Pay with <amount>",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Pay with <amount>\")",
    "fun pay(amount: String) {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/Steps.kt");
  const client = {
    sendRequest() {
      return {
        changes: {
          "file:///workspace/gauge/specs/checkout.spec": [
            {
              range: {
                start: { line: 1, character: 2 },
                end: { line: 1, character: 19 },
              },
              newText: "Pay with <value>",
            },
          ],
        },
      };
    },
  };
  const clientsMap = {
    get(file) {
      assert.equal(file, "/workspace/gauge/specs/checkout.spec");
      return { client };
    },
  };
  const vscode = createFakeVscode([specDocument, kotlinDocument]);
  const provider = new GaugeRenameProvider({ clientsMap, vscode });

  const edit = await provider.provideRenameEdits(
    specDocument,
    new vscode.Position(1, 4),
    "Pay with <value>",
  );

  assert.deepEqual(
    edit.replacements.map((replacement) => ({
      file: replacement.uri.fsPath,
      range: {
        start: { ...replacement.range.start },
        end: { ...replacement.range.end },
      },
      newText: replacement.newText,
    })),
    [
      {
        file: "/workspace/gauge/specs/checkout.spec",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 19 },
        },
        newText: "Pay with <value>",
      },
      {
        file: "/workspace/gauge/src/test/kotlin/Steps.kt",
        range: {
          start: { line: 2, character: 7 },
          end: { line: 2, character: 24 },
        },
        newText: "Pay with <value>",
      },
      {
        file: "/workspace/gauge/src/test/kotlin/Steps.kt",
        range: {
          start: { line: 3, character: 8 },
          end: { line: 3, character: 22 },
        },
        newText: "argValue: Any",
      },
    ],
  );
});

test("GaugeRenameProvider reports Gauge language server rename errors", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Checkout",
    "* Pay with <amount>",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const client = {
    sendRequest() {
      throw new Error("refactoring failed due to parse errors");
    },
  };
  const clientsMap = {
    get() {
      return { client };
    },
  };
  const vscode = createFakeVscode([specDocument]);
  const provider = new GaugeRenameProvider({ clientsMap, vscode });

  await assert.rejects(
    () => provider.provideRenameEdits(
      specDocument,
      new vscode.Position(1, 4),
      "Pay with <value>",
    ),
    /refactoring failed due to parse errors/,
  );
});

test("GaugeRenameProvider rejects local renames when Gauge validate reports errors", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Checkout",
    "* Pay with <amount>",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Pay with <amount>\")",
    "fun pay(amount: String) {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/Steps.kt");
  const spawnSyncCalls = [];
  const cli = {
    gaugeCommand() {
      return {
        spawnSync(args, options) {
          spawnSyncCalls.push({ args, options });
          return {
            stdout: "",
            stderr: "Error /workspace/gauge/specs/checkout.spec:2: Undefined step",
          };
        },
      };
    },
  };
  const project = {
    root() {
      return "/workspace/gauge";
    },
    envs(receivedCli) {
      assert.equal(receivedCli, cli);
      return { gauge_custom_classpath: "/workspace/gauge/out/test/gauge" };
    },
  };
  const projectFactory = {
    getGaugeRootFromFilePath(filename) {
      assert.ok(filename.startsWith("/workspace/gauge/"));
      return "/workspace/gauge";
    },
    get(root) {
      assert.equal(root, "/workspace/gauge");
      return project;
    },
  };
  const vscode = createFakeVscode([specDocument, kotlinDocument]);
  const provider = new GaugeRenameProvider({
    cli,
    env: { PATH: "/bin" },
    projectFactory,
    vscode,
  });

  await assert.rejects(
    () => provider.provideRenameEdits(
      specDocument,
      new vscode.Position(1, 4),
      "Pay with <value>",
    ),
    /Please fix all errors before refactoring/,
  );
  assert.deepEqual(spawnSyncCalls, [
    {
      args: ["validate"],
      options: {
        cwd: "/workspace/gauge",
        env: {
          PATH: "/bin",
          gauge_custom_classpath: "/workspace/gauge/out/test/gauge",
        },
      },
    },
  ]);
});

test("GaugeRenameProvider rejects language server renames when Gauge validate reports errors", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Checkout",
    "* Pay with <amount>",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const requests = [];
  const saveAllCalls = [];
  const client = {
    sendRequest(method, params, token) {
      requests.push({ method, params, token });
      return { changes: {} };
    },
  };
  const clientsMap = {
    get(file) {
      assert.equal(file, "/workspace/gauge/specs/checkout.spec");
      return { client };
    },
  };
  const validateDiagnosticsProvider = {
    validateErrorsForDocument(document, diagnostics) {
      assert.equal(document, specDocument);
      assert.ok(diagnostics instanceof Map);
      return {
        errors: [{ message: "Undefined step" }],
      };
    },
  };
  const vscode = createFakeVscode([specDocument]);
  vscode.workspace.saveAll = () => {
    saveAllCalls.push(true);
    return Promise.resolve(true);
  };
  const provider = new GaugeRenameProvider({
    clientsMap,
    validateDiagnosticsProvider,
    vscode,
  });

  await assert.rejects(
    () => provider.provideRenameEdits(
      specDocument,
      new vscode.Position(1, 4),
      "Pay with <value>",
    ),
    /Please fix all errors before refactoring/,
  );
  assert.deepEqual(saveAllCalls, [true]);
  assert.deepEqual(requests, []);
});

test("GaugeRenameProvider rejects renames when implementation diagnostics report compile errors", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Checkout",
    "* Pay with <amount>",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Pay with <amount>\")",
    "fun pay(amount: String) {",
    "  missingSymbol()",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/Steps.kt");
  const saveAllCalls = [];
  const validateCalls = [];
  const diagnosticCalls = [];
  const projectFactory = {
    getGaugeRootFromFilePath(filename) {
      assert.ok(filename.startsWith("/workspace/gauge/"));
      return "/workspace/gauge";
    },
  };
  const vscode = createFakeVscode([specDocument, kotlinDocument]);
  vscode.DiagnosticSeverity = { Error: 0, Warning: 1 };
  vscode.workspace.saveAll = () => {
    saveAllCalls.push(true);
    return Promise.resolve(true);
  };
  vscode.languages = {
    getDiagnostics(uri) {
      diagnosticCalls.push(uri);
      return [
        [
          kotlinDocument.uri,
          [{ message: "Unresolved reference: missingSymbol", severity: vscode.DiagnosticSeverity.Error }],
        ],
      ];
    },
  };
  const provider = new GaugeRenameProvider({
    projectFactory,
    validateDiagnosticsProvider: {
      validateErrorsForDocument() {
        validateCalls.push(true);
        return { errors: [] };
      },
    },
    vscode,
  });

  await assert.rejects(
    () => provider.provideRenameEdits(
      specDocument,
      new vscode.Position(1, 4),
      "Pay with <value>",
    ),
    /Please fix all errors before refactoring/,
  );
  assert.deepEqual(saveAllCalls, [true]);
  assert.equal(diagnosticCalls.length > 0, true);
  assert.deepEqual(validateCalls, []);
});

test("GaugeRenameProvider renames Gauge steps and Kotlin Step annotations", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Checkout",
    "* Pay with <amount>",
    "* Confirm order",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const otherSpecDocument = createDocument([
    "# Retry",
    "* Pay with <amount>",
  ].join("\n"), "gauge", "/workspace/gauge/specs/retry.spec");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Pay with <amount>\")",
    "fun pay(amount: String) {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/Steps.kt");
  const vscode = createFakeVscode([specDocument, otherSpecDocument, kotlinDocument]);
  const provider = new GaugeRenameProvider({ vscode });

  const edit = await provider.provideRenameEdits(
    specDocument,
    new vscode.Position(1, 4),
    "Pay with <value>",
  );

  assert.deepEqual(
    edit.replacements.map((replacement) => ({
      file: replacement.uri.fsPath,
      range: {
        start: { ...replacement.range.start },
        end: { ...replacement.range.end },
      },
      newText: replacement.newText,
    })),
    [
      {
        file: "/workspace/gauge/specs/checkout.spec",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 19 },
        },
        newText: "Pay with <value>",
      },
      {
        file: "/workspace/gauge/specs/retry.spec",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 19 },
        },
        newText: "Pay with <value>",
      },
      {
        file: "/workspace/gauge/src/test/kotlin/Steps.kt",
        range: {
          start: { line: 2, character: 7 },
          end: { line: 2, character: 24 },
        },
        newText: "Pay with <value>",
      },
      {
        file: "/workspace/gauge/src/test/kotlin/Steps.kt",
        range: {
          start: { line: 3, character: 8 },
          end: { line: 3, character: 22 },
        },
        newText: "argValue: Any",
      },
    ],
  );
});

test("GaugeRenameProvider updates Kotlin Step function parameters when rename adds a preceding parameter", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Basic",
    "* a basic step \"param\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/basic.spec");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"a basic step <param>\")",
    "fun basic(param: String) {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/Steps.kt");
  const vscode = createFakeVscode([specDocument, kotlinDocument]);
  const provider = new GaugeRenameProvider({ vscode });

  const edit = await provider.provideRenameEdits(
    specDocument,
    new vscode.Position(1, 4),
    "a basic step \"before\" \"param\"",
  );

  assert.deepEqual(
    edit.replacements.map((replacement) => ({
      file: replacement.uri.fsPath,
      range: {
        start: { ...replacement.range.start },
        end: { ...replacement.range.end },
      },
      newText: replacement.newText,
    })),
    [
      {
        file: "/workspace/gauge/specs/basic.spec",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 22 },
        },
        newText: "a basic step \"before\" \"param\"",
      },
      {
        file: "/workspace/gauge/src/test/kotlin/Steps.kt",
        range: {
          start: { line: 2, character: 7 },
          end: { line: 2, character: 27 },
        },
        newText: "a basic step <before> <param>",
      },
      {
        file: "/workspace/gauge/src/test/kotlin/Steps.kt",
        range: {
          start: { line: 3, character: 10 },
          end: { line: 3, character: 23 },
        },
        newText: "argBefore: Any, param: String",
      },
    ],
  );
});

test("GaugeRenameProvider normalizes table file parameters in Kotlin Step implementations", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Basic",
    "* a basic step",
  ].join("\n"), "gauge", "/workspace/gauge/specs/basic.spec");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"a basic step\")",
    "fun basic() {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/Steps.kt");
  const vscode = createFakeVscode([specDocument, kotlinDocument]);
  const provider = new GaugeRenameProvider({ vscode });

  const edit = await provider.provideRenameEdits(
    specDocument,
    new vscode.Position(1, 4),
    "a basic step <table:validTable.csv>",
  );

  assert.deepEqual(
    edit.replacements.map((replacement) => ({
      file: replacement.uri.fsPath,
      range: {
        start: { ...replacement.range.start },
        end: { ...replacement.range.end },
      },
      newText: replacement.newText,
    })),
    [
      {
        file: "/workspace/gauge/specs/basic.spec",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 14 },
        },
        newText: "a basic step <table:validTable.csv>",
      },
      {
        file: "/workspace/gauge/src/test/kotlin/Steps.kt",
        range: {
          start: { line: 2, character: 7 },
          end: { line: 2, character: 19 },
        },
        newText: "a basic step <table1>",
      },
      {
        file: "/workspace/gauge/src/test/kotlin/Steps.kt",
        range: {
          start: { line: 3, character: 10 },
          end: { line: 3, character: 10 },
        },
        newText: "argTable1: Any",
      },
    ],
  );
});

test("GaugeRenameProvider keeps existing Kotlin parameter names when renaming specs to static arguments", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Vowels",
    "* Vowels in English language are \"aeiou\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/vowels.spec");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Vowels in English language are <vowelString>\")",
    "fun setLanguageVowels(vowelString: String) {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/Steps.kt");
  const vscode = createFakeVscode([specDocument, kotlinDocument]);
  const provider = new GaugeRenameProvider({ vscode });

  const edit = await provider.provideRenameEdits(
    specDocument,
    new vscode.Position(1, 4),
    "Vowels in English language are \"aeiou\"",
  );

  assert.deepEqual(
    edit.replacements.map((replacement) => ({
      file: replacement.uri.fsPath,
      range: {
        start: { ...replacement.range.start },
        end: { ...replacement.range.end },
      },
      newText: replacement.newText,
    })),
    [
      {
        file: "/workspace/gauge/specs/vowels.spec",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 40 },
        },
        newText: "Vowels in English language are \"aeiou\"",
      },
      {
        file: "/workspace/gauge/src/test/kotlin/Steps.kt",
        range: {
          start: { line: 2, character: 7 },
          end: { line: 2, character: 51 },
        },
        newText: "Vowels in English language are <vowelString>",
      },
    ],
  );
});

test("GaugeRenameProvider replaces Kotlin parameters when dynamic argument names change", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Checkout",
    "* Pay with <amount>",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Pay with <amount>\")",
    "fun pay(amount: String) {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/Steps.kt");
  const vscode = createFakeVscode([specDocument, kotlinDocument]);
  const provider = new GaugeRenameProvider({ vscode });

  const edit = await provider.provideRenameEdits(
    specDocument,
    new vscode.Position(1, 4),
    "Pay with <value>",
  );

  assert.deepEqual(
    edit.replacements.map((replacement) => ({
      file: replacement.uri.fsPath,
      range: {
        start: { ...replacement.range.start },
        end: { ...replacement.range.end },
      },
      newText: replacement.newText,
    })),
    [
      {
        file: "/workspace/gauge/specs/checkout.spec",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 19 },
        },
        newText: "Pay with <value>",
      },
      {
        file: "/workspace/gauge/src/test/kotlin/Steps.kt",
        range: {
          start: { line: 2, character: 7 },
          end: { line: 2, character: 24 },
        },
        newText: "Pay with <value>",
      },
      {
        file: "/workspace/gauge/src/test/kotlin/Steps.kt",
        range: {
          start: { line: 3, character: 8 },
          end: { line: 3, character: 22 },
        },
        newText: "argValue: Any",
      },
    ],
  );
});

test("GaugeRenameProvider removes Kotlin parameters when rename removes all step parameters", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Checkout",
    "* Pay with <amount>",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Pay with <amount>\")",
    "fun pay(amount: String) {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/Steps.kt");
  const vscode = createFakeVscode([specDocument, kotlinDocument]);
  const provider = new GaugeRenameProvider({ vscode });

  const edit = await provider.provideRenameEdits(
    specDocument,
    new vscode.Position(1, 4),
    "Pay now",
  );

  assert.deepEqual(
    edit.replacements.map((replacement) => ({
      file: replacement.uri.fsPath,
      range: {
        start: { ...replacement.range.start },
        end: { ...replacement.range.end },
      },
      newText: replacement.newText,
    })),
    [
      {
        file: "/workspace/gauge/specs/checkout.spec",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 19 },
        },
        newText: "Pay now",
      },
      {
        file: "/workspace/gauge/src/test/kotlin/Steps.kt",
        range: {
          start: { line: 2, character: 7 },
          end: { line: 2, character: 24 },
        },
        newText: "Pay now",
      },
      {
        file: "/workspace/gauge/src/test/kotlin/Steps.kt",
        range: {
          start: { line: 3, character: 8 },
          end: { line: 3, character: 22 },
        },
        newText: "",
      },
    ],
  );
});

test("GaugeRenameProvider escapes Kotlin string templates in Step annotations", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Checkout",
    "* Pay with <amount>",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Pay with <amount>\")",
    "fun pay(amount: String) {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/Steps.kt");
  const vscode = createFakeVscode([specDocument, kotlinDocument]);
  const provider = new GaugeRenameProvider({ vscode });

  const edit = await provider.provideRenameEdits(
    specDocument,
    new vscode.Position(1, 4),
    "Pay $amount",
  );

  assert.deepEqual(
    edit.replacements.map((replacement) => ({
      file: replacement.uri.fsPath,
      range: {
        start: { ...replacement.range.start },
        end: { ...replacement.range.end },
      },
      newText: replacement.newText,
    })),
    [
      {
        file: "/workspace/gauge/specs/checkout.spec",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 19 },
        },
        newText: "Pay $amount",
      },
      {
        file: "/workspace/gauge/src/test/kotlin/Steps.kt",
        range: {
          start: { line: 2, character: 7 },
          end: { line: 2, character: 24 },
        },
        newText: "Pay \\$amount",
      },
      {
        file: "/workspace/gauge/src/test/kotlin/Steps.kt",
        range: {
          start: { line: 3, character: 8 },
          end: { line: 3, character: 22 },
        },
        newText: "",
      },
    ],
  );
});

test("GaugeRenameProvider renames Markdown Gauge steps and Kotlin Step annotations", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Checkout",
    "* Pay with <amount>",
  ].join("\n"), "markdown", "/workspace/gauge/specs/checkout.md");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Pay with <amount>\")",
    "fun pay(amount: String) {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/Steps.kt");
  const vscode = createFakeVscode([specDocument, kotlinDocument]);
  const provider = new GaugeRenameProvider({ vscode });

  const edit = await provider.provideRenameEdits(
    specDocument,
    new vscode.Position(1, 4),
    "Pay with <value>",
  );

  assert.deepEqual(
    edit.replacements.map((replacement) => ({
      file: replacement.uri.fsPath,
      range: {
        start: { ...replacement.range.start },
        end: { ...replacement.range.end },
      },
      newText: replacement.newText,
    })),
    [
      {
        file: "/workspace/gauge/specs/checkout.md",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 19 },
        },
        newText: "Pay with <value>",
      },
      {
        file: "/workspace/gauge/src/test/kotlin/Steps.kt",
        range: {
          start: { line: 2, character: 7 },
          end: { line: 2, character: 24 },
        },
        newText: "Pay with <value>",
      },
      {
        file: "/workspace/gauge/src/test/kotlin/Steps.kt",
        range: {
          start: { line: 3, character: 8 },
          end: { line: 3, character: 22 },
        },
        newText: "argValue: Any",
      },
    ],
  );
});

test("GaugeRenameProvider renames spec files by extension and Kotlin Step annotations", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Checkout",
    "* Pay with <amount>",
  ].join("\n"), "plaintext", "/workspace/gauge/specs/checkout.spec");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Pay with <amount>\")",
    "fun pay(amount: String) {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/Steps.kt");
  const vscode = createFakeVscode([specDocument, kotlinDocument]);
  const provider = new GaugeRenameProvider({ vscode });

  const edit = await provider.provideRenameEdits(
    specDocument,
    new vscode.Position(1, 4),
    "Pay with <value>",
  );

  assert.deepEqual(
    edit.replacements.map((replacement) => ({
      file: replacement.uri.fsPath,
      range: {
        start: { ...replacement.range.start },
        end: { ...replacement.range.end },
      },
      newText: replacement.newText,
    })),
    [
      {
        file: "/workspace/gauge/specs/checkout.spec",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 19 },
        },
        newText: "Pay with <value>",
      },
      {
        file: "/workspace/gauge/src/test/kotlin/Steps.kt",
        range: {
          start: { line: 2, character: 7 },
          end: { line: 2, character: 24 },
        },
        newText: "Pay with <value>",
      },
      {
        file: "/workspace/gauge/src/test/kotlin/Steps.kt",
        range: {
          start: { line: 3, character: 8 },
          end: { line: 3, character: 22 },
        },
        newText: "argValue: Any",
      },
    ],
  );
});

test("GaugeRenameProvider renames Kotlin constants backing Step annotations", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Login",
    "* Log in as \"alice\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/login.spec");
  const constantsDocument = createDocument([
    "package steps",
    "",
    "object StepText {",
    "  const val LOGIN = \"Log in as <user>\"",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/steps/StepText.kt");
  const kotlinDocument = createDocument([
    "package steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "class LoginSteps {",
    "  @Step(StepText.LOGIN)",
    "  fun login(user: String) {}",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/steps/LoginSteps.kt");
  const vscode = createFakeVscode([specDocument, constantsDocument, kotlinDocument]);
  const provider = new GaugeRenameProvider({ vscode });

  const edit = await provider.provideRenameEdits(
    specDocument,
    new vscode.Position(1, 4),
    "Sign in as <user>",
  );

  assert.deepEqual(
    edit.replacements.map((replacement) => ({
      file: replacement.uri.fsPath,
      range: {
        start: { ...replacement.range.start },
        end: { ...replacement.range.end },
      },
      newText: replacement.newText,
    })),
    [
      {
        file: "/workspace/gauge/specs/login.spec",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 19 },
        },
        newText: "Sign in as <user>",
      },
      {
        file: "/workspace/gauge/src/test/kotlin/steps/StepText.kt",
        range: {
          start: { line: 3, character: 21 },
          end: { line: 3, character: 37 },
        },
        newText: "Sign in as <user>",
      },
    ],
  );
});

test("GaugeRenameProvider renames Kotlin constants from constant-backed Step annotations", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Login",
    "* Log in as \"alice\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/login.spec");
  const constantsDocument = createDocument([
    "package steps",
    "",
    "object StepText {",
    "  const val LOGIN = \"Log in as <user>\"",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/steps/StepText.kt");
  const kotlinDocument = createDocument([
    "package steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "class LoginSteps {",
    "  @Step(StepText.LOGIN)",
    "  fun login(user: String) {}",
    "}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/steps/LoginSteps.kt");
  const vscode = createFakeVscode([specDocument, constantsDocument, kotlinDocument]);
  const provider = new GaugeRenameProvider({ vscode });

  const prepared = await provider.prepareRename(kotlinDocument, new vscode.Position(5, 12));
  const edit = await provider.provideRenameEdits(
    kotlinDocument,
    new vscode.Position(5, 12),
    "Sign in as <user>",
  );

  assert.deepEqual(
    {
      placeholder: prepared.placeholder,
      range: {
        start: { ...prepared.range.start },
        end: { ...prepared.range.end },
      },
    },
    {
      placeholder: "Log in as <user>",
      range: {
        start: { line: 5, character: 8 },
        end: { line: 5, character: 22 },
      },
    },
  );
  assert.deepEqual(
    edit.replacements.map((replacement) => ({
      file: replacement.uri.fsPath,
      range: {
        start: { ...replacement.range.start },
        end: { ...replacement.range.end },
      },
      newText: replacement.newText,
    })),
    [
      {
        file: "/workspace/gauge/specs/login.spec",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 19 },
        },
        newText: "Sign in as <user>",
      },
      {
        file: "/workspace/gauge/src/test/kotlin/steps/StepText.kt",
        range: {
          start: { line: 3, character: 21 },
          end: { line: 3, character: 37 },
        },
        newText: "Sign in as <user>",
      },
    ],
  );
});

test("GaugeRenameProvider renames Java constants backing Step annotations", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Login",
    "* Log in as \"alice\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/login.spec");
  const constantsDocument = createDocument([
    "package fixtures.steps;",
    "",
    "public final class JavaStepText {",
    "  public static final String LOGIN = \"Log in as <user>\";",
    "}",
  ].join("\n"), "java", "/workspace/gauge/src/test/java/fixtures/steps/JavaStepText.java");
  const javaDocument = createDocument([
    "package fixtures.impl;",
    "",
    "import com.thoughtworks.gauge.Step;",
    "import fixtures.steps.JavaStepText;",
    "",
    "public class LoginSteps {",
    "  @Step(JavaStepText.LOGIN)",
    "  public void login(String user) {",
    "  }",
    "}",
  ].join("\n"), "java", "/workspace/gauge/src/test/java/fixtures/impl/LoginSteps.java");
  const vscode = createFakeVscode([specDocument, constantsDocument, javaDocument]);
  const provider = new GaugeRenameProvider({ vscode });

  const edit = await provider.provideRenameEdits(
    specDocument,
    new vscode.Position(1, 4),
    "Sign in as <user>",
  );

  assert.deepEqual(
    edit.replacements.map((replacement) => ({
      file: replacement.uri.fsPath,
      range: {
        start: { ...replacement.range.start },
        end: { ...replacement.range.end },
      },
      newText: replacement.newText,
    })),
    [
      {
        file: "/workspace/gauge/specs/login.spec",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 19 },
        },
        newText: "Sign in as <user>",
      },
      {
        file: "/workspace/gauge/src/test/java/fixtures/steps/JavaStepText.java",
        range: {
          start: { line: 3, character: 38 },
          end: { line: 3, character: 54 },
        },
        newText: "Sign in as <user>",
      },
    ],
  );
});

test("GaugeRenameProvider scopes Java static-imported constant renames", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Login",
    "* Log in as \"alice\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/login.spec");
  const importedConstantsDocument = createDocument([
    "package fixtures.steps;",
    "",
    "public final class JavaStepText {",
    "  public static final String LOGIN = \"Log in as <user>\";",
    "}",
  ].join("\n"), "java", "/workspace/gauge/src/test/java/fixtures/steps/JavaStepText.java");
  const unrelatedConstantsDocument = createDocument([
    "package other.steps;",
    "",
    "public final class OtherStepText {",
    "  public static final String LOGIN = \"Log in as <user>\";",
    "}",
  ].join("\n"), "java", "/workspace/gauge/src/test/java/other/steps/OtherStepText.java");
  const javaDocument = createDocument([
    "package fixtures.impl;",
    "",
    "import com.thoughtworks.gauge.Step;",
    "import static fixtures.steps.JavaStepText.LOGIN;",
    "",
    "public class LoginSteps {",
    "  @Step(LOGIN)",
    "  public void login(String user) {",
    "  }",
    "}",
  ].join("\n"), "java", "/workspace/gauge/src/test/java/fixtures/impl/LoginSteps.java");
  const vscode = createFakeVscode([
    specDocument,
    importedConstantsDocument,
    unrelatedConstantsDocument,
    javaDocument,
  ]);
  const provider = new GaugeRenameProvider({ vscode });

  const edit = await provider.provideRenameEdits(
    specDocument,
    new vscode.Position(1, 4),
    "Sign in as <user>",
  );

  assert.deepEqual(
    edit.replacements.map((replacement) => ({
      file: replacement.uri.fsPath,
      range: {
        start: { ...replacement.range.start },
        end: { ...replacement.range.end },
      },
      newText: replacement.newText,
    })),
    [
      {
        file: "/workspace/gauge/specs/login.spec",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 19 },
        },
        newText: "Sign in as <user>",
      },
      {
        file: "/workspace/gauge/src/test/java/fixtures/steps/JavaStepText.java",
        range: {
          start: { line: 3, character: 38 },
          end: { line: 3, character: 54 },
        },
        newText: "Sign in as <user>",
      },
    ],
  );
});

test("GaugeRenameProvider renames Java constants from constant-backed Step annotations", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Login",
    "* Log in as \"alice\"",
  ].join("\n"), "gauge", "/workspace/gauge/specs/login.spec");
  const constantsDocument = createDocument([
    "package fixtures.steps;",
    "",
    "public final class JavaStepText {",
    "  public static final String LOGIN = \"Log in as <user>\";",
    "}",
  ].join("\n"), "java", "/workspace/gauge/src/test/java/fixtures/steps/JavaStepText.java");
  const javaDocument = createDocument([
    "package fixtures.impl;",
    "",
    "import com.thoughtworks.gauge.Step;",
    "import fixtures.steps.JavaStepText;",
    "",
    "public class LoginSteps {",
    "  @Step(JavaStepText.LOGIN)",
    "  public void login(String user) {",
    "  }",
    "}",
  ].join("\n"), "java", "/workspace/gauge/src/test/java/fixtures/impl/LoginSteps.java");
  const vscode = createFakeVscode([specDocument, constantsDocument, javaDocument]);
  const provider = new GaugeRenameProvider({ vscode });

  const prepared = await provider.prepareRename(javaDocument, new vscode.Position(6, 12));
  const edit = await provider.provideRenameEdits(
    javaDocument,
    new vscode.Position(6, 12),
    "Sign in as <user>",
  );

  assert.deepEqual(
    {
      placeholder: prepared.placeholder,
      range: {
        start: { ...prepared.range.start },
        end: { ...prepared.range.end },
      },
    },
    {
      placeholder: "Log in as <user>",
      range: {
        start: { line: 6, character: 8 },
        end: { line: 6, character: 26 },
      },
    },
  );
  assert.deepEqual(
    edit.replacements.map((replacement) => ({
      file: replacement.uri.fsPath,
      range: {
        start: { ...replacement.range.start },
        end: { ...replacement.range.end },
      },
      newText: replacement.newText,
    })),
    [
      {
        file: "/workspace/gauge/specs/login.spec",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 19 },
        },
        newText: "Sign in as <user>",
      },
      {
        file: "/workspace/gauge/src/test/java/fixtures/steps/JavaStepText.java",
        range: {
          start: { line: 3, character: 38 },
          end: { line: 3, character: 54 },
        },
        newText: "Sign in as <user>",
      },
    ],
  );
});

test("GaugeRenameProvider renames from Java Step annotations", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Checkout",
    "* Pay with <amount>",
    "* Confirm order",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const javaDocument = createDocument([
    "package steps;",
    "",
    "import com.thoughtworks.gauge.Step;",
    "",
    "public class Steps {",
    "  @Step(\"Pay with <amount>\")",
    "  public void pay(String amount) {",
    "  }",
    "}",
  ].join("\n"), "plaintext", "/workspace/gauge/src/test/java/Steps.java");
  const vscode = createFakeVscode([specDocument, javaDocument]);
  const provider = new GaugeRenameProvider({ vscode });

  const edit = await provider.provideRenameEdits(
    javaDocument,
    new vscode.Position(5, 12),
    "Pay with <value>",
  );

  assert.deepEqual(
    edit.replacements.map((replacement) => ({
      file: replacement.uri.fsPath,
      range: {
        start: { ...replacement.range.start },
        end: { ...replacement.range.end },
      },
      newText: replacement.newText,
    })),
    [
      {
        file: "/workspace/gauge/specs/checkout.spec",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 19 },
        },
        newText: "Pay with <value>",
      },
      {
        file: "/workspace/gauge/src/test/java/Steps.java",
        range: {
          start: { line: 5, character: 9 },
          end: { line: 5, character: 26 },
        },
        newText: "Pay with <value>",
      },
    ],
  );
});

test("GaugeRenameProvider keeps Java Step annotation dollar text unescaped", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Checkout",
    "* Pay with <amount>",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const javaDocument = createDocument([
    "package steps;",
    "",
    "import com.thoughtworks.gauge.Step;",
    "",
    "public class Steps {",
    "  @Step(\"Pay with <amount>\")",
    "  public void pay(String amount) {",
    "  }",
    "}",
  ].join("\n"), "plaintext", "/workspace/gauge/src/test/java/Steps.java");
  const vscode = createFakeVscode([specDocument, javaDocument]);
  const provider = new GaugeRenameProvider({ vscode });

  const edit = await provider.provideRenameEdits(
    specDocument,
    new vscode.Position(1, 4),
    "Pay $amount",
  );

  assert.deepEqual(
    edit.replacements.map((replacement) => ({
      file: replacement.uri.fsPath,
      newText: replacement.newText,
    })),
    [
      {
        file: "/workspace/gauge/specs/checkout.spec",
        newText: "Pay $amount",
      },
      {
        file: "/workspace/gauge/src/test/java/Steps.java",
        newText: "Pay $amount",
      },
    ],
  );
});

test("GaugeRenameProvider does not open unopened files outside Gauge projects during workspace scans", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Checkout",
    "* Pay with <amount>",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const nonGaugeUri = { fsPath: "/workspace/notes/example.md" };
  const opened = [];
  const patterns = [];
  const vscode = {
    ...createFakeVscode([specDocument]),
    workspace: {
      textDocuments: [specDocument],
      async findFiles(pattern) {
        patterns.push(pattern);
        return [nonGaugeUri];
      },
      async openTextDocument(uri) {
        opened.push(uri.fsPath);
        return createDocument([
          "# Notes",
          "",
          "* Pay with <amount>",
        ].join("\n"), "markdown", uri.fsPath);
      },
    },
  };
  const provider = new GaugeRenameProvider({
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        if (filename.startsWith("/workspace/gauge/")) {
          return "/workspace/gauge";
        }
        if (filename.startsWith("/workspace/notes/")) {
          return "/workspace/notes";
        }
        return undefined;
      },
      isGaugeProject(root) {
        return root === "/workspace/gauge";
      },
    },
    vscode,
  });

  const documents = await provider.workspaceDocuments(specDocument);

  assert.deepEqual(patterns, ["**/*.spec", "**/*.cpt", "**/*.md", "**/*.kt", "**/*.java"]);
  assert.deepEqual(opened, []);
  assert.deepEqual(documents.map((document) => document.uri.fsPath), [
    "/workspace/gauge/specs/checkout.spec",
  ]);
});

test("GaugeRenameProvider preserves inline table step identity when renaming", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Checkout",
    "* Pay with account",
    "  | id |",
    "  | 42 |",
    "* Pay with account",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Pay with account <table>\")",
    "fun pay(table: Table) {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/Steps.kt");
  const vscode = createFakeVscode([specDocument, kotlinDocument]);
  const provider = new GaugeRenameProvider({ vscode });

  const edit = await provider.provideRenameEdits(
    specDocument,
    new vscode.Position(1, 4),
    "Pay with ledger",
  );

  assert.deepEqual(
    edit.replacements.map((replacement) => ({
      file: replacement.uri.fsPath,
      range: {
        start: { ...replacement.range.start },
        end: { ...replacement.range.end },
      },
      newText: replacement.newText,
    })),
    [
      {
        file: "/workspace/gauge/specs/checkout.spec",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 18 },
        },
        newText: "Pay with ledger",
      },
      {
        file: "/workspace/gauge/src/test/kotlin/Steps.kt",
        range: {
          start: { line: 2, character: 7 },
          end: { line: 2, character: 31 },
        },
        newText: "Pay with ledger <table>",
      },
    ],
  );
});

test("GaugeRenameProvider renames concept headings when renaming concept usages", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Checkout",
    "* Reuse payment <card>",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const conceptDocument = createDocument([
    "# Reuse payment <method>",
    "* Confirm order",
  ].join("\n"), "gauge", "/workspace/gauge/specs/concepts/payment.cpt");
  const vscode = createFakeVscode([specDocument, conceptDocument]);
  const provider = new GaugeRenameProvider({ vscode });

  const edit = await provider.provideRenameEdits(
    specDocument,
    new vscode.Position(1, 4),
    "Shared payment <account>",
  );

  assert.deepEqual(
    edit.replacements.map((replacement) => ({
      file: replacement.uri.fsPath,
      range: {
        start: { ...replacement.range.start },
        end: { ...replacement.range.end },
      },
      newText: replacement.newText,
    })),
    [
      {
        file: "/workspace/gauge/specs/checkout.spec",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 22 },
        },
        newText: "Shared payment <account>",
      },
      {
        file: "/workspace/gauge/specs/concepts/payment.cpt",
        range: {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 24 },
        },
        newText: "Shared payment <account>",
      },
    ],
  );
});

test("GaugeRenameProvider renames concept headings from concept files by extension", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Checkout",
    "* Reuse payment <card>",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const conceptDocument = createDocument([
    "# Reuse payment <method>",
    "* Confirm order",
  ].join("\n"), "plaintext", "/workspace/gauge/specs/concepts/payment.cpt");
  const vscode = createFakeVscode([specDocument, conceptDocument]);
  const provider = new GaugeRenameProvider({ vscode });

  const prepared = await provider.prepareRename(conceptDocument, new vscode.Position(0, 4));
  const edit = await provider.provideRenameEdits(
    conceptDocument,
    new vscode.Position(0, 4),
    "Shared payment <account>",
  );

  assert.deepEqual({
    placeholder: prepared.placeholder,
    range: {
      start: { ...prepared.range.start },
      end: { ...prepared.range.end },
    },
  }, {
    placeholder: "Reuse payment <method>",
    range: {
      start: { line: 0, character: 2 },
      end: { line: 0, character: 24 },
    },
  });
  assert.deepEqual(
    edit.replacements.map((replacement) => ({
      file: replacement.uri.fsPath,
      range: {
        start: { ...replacement.range.start },
        end: { ...replacement.range.end },
      },
      newText: replacement.newText,
    })),
    [
      {
        file: "/workspace/gauge/specs/checkout.spec",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 22 },
        },
        newText: "Shared payment <account>",
      },
      {
        file: "/workspace/gauge/specs/concepts/payment.cpt",
        range: {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 24 },
        },
        newText: "Shared payment <account>",
      },
    ],
  );
});

test("GaugeRenameProvider rejects renames for aliased Kotlin Step implementations", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Checkout",
    "* Pay with <amount>",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Pay with <amount>\", \"Pay by <amount>\")",
    "fun pay(amount: String) {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/Steps.kt");
  const vscode = createFakeVscode([specDocument, kotlinDocument]);
  const provider = new GaugeRenameProvider({ vscode });

  await assert.rejects(
    () => provider.prepareRename(specDocument, new vscode.Position(1, 4)),
    /Refactoring for steps having aliases are not supported/,
  );
  await assert.rejects(
    () => provider.provideRenameEdits(
      specDocument,
      new vscode.Position(1, 4),
      "Pay with <value>",
    ),
    /Refactoring for steps having aliases are not supported/,
  );
});

test("GaugeRenameProvider rejects implementation renames for aliased Kotlin Step annotations", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Pay with <amount>\", \"Pay by <amount>\")",
    "fun pay(amount: String) {}",
  ].join("\n"), "kotlin", "/workspace/gauge/src/test/kotlin/Steps.kt");
  const vscode = createFakeVscode([kotlinDocument]);
  const provider = new GaugeRenameProvider({ vscode });

  await assert.rejects(
    () => provider.prepareRename(kotlinDocument, new vscode.Position(2, 10)),
    /Refactoring for steps having aliases are not supported/,
  );
});

test("GaugeRenameProvider prepares indented Gauge step lines", async () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const specDocument = createDocument([
    "# Checkout",
    "  * Pay with <amount>",
  ].join("\n"), "gauge", "/workspace/gauge/specs/checkout.spec");
  const vscode = createFakeVscode([specDocument]);
  const provider = new GaugeRenameProvider({ vscode });

  const prepared = await provider.prepareRename(specDocument, new vscode.Position(1, 6));

  assert.equal(prepared.placeholder, "Pay with <amount>");
  assert.deepEqual({ ...prepared.range.start }, { line: 1, character: 4 });
  assert.deepEqual({ ...prepared.range.end }, { line: 1, character: 21 });
});

test("GaugeRenameProvider registers plaintext Kotlin file rename selector", () => {
  const { GaugeRenameProvider } = require("../src/renameProvider");
  const vscode = createRegistrationVscode();
  const provider = new GaugeRenameProvider({ vscode });

  provider.register();

  assert.deepEqual(vscode.registration.selector, [
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
  assert.equal(vscode.registration.provider, provider);
});
