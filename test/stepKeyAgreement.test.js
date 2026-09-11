const assert = require("node:assert/strict");
const test = require("node:test");

// Every surface that answers "is this step implemented?" must derive the same
// key for the same step. The diagnostics, Go to Definition, the Kotlin reference
// lens and Rename each derive it independently, so they can disagree - and a
// disagreement is worse than either answer alone: the editor reports a step
// implemented and suppresses the runner's correct verdict, or reports it
// undefined while F12 resolves it, or rewrites a specification while leaving the
// annotation that no longer matches it.
//
// A per-module test cannot observe a disagreement between modules. This file is
// where that observation lives: one truth per shape, checked against all four.
//
// The truth for each shape below is what the real Gauge parser and the real
// gauge-java runner do - see the rule tables in src/gaugeHeadings.js and
// src/gaugeStepValue.js. A failure here means a module has diverged from the
// runner; the fix is to make it agree, never to relax the expectation without
// re-establishing the behaviour against Gauge itself.

const { GaugeStepDiagnosticsProvider } = require("../src/stepDiagnostics");
const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
const { GaugeRenameProvider } = require("../src/renameProvider");

const SPEC_PATH = "/workspace/gauge/specs/agreement.spec";
const KOTLIN_PATH = "/workspace/gauge/src/test/kotlin/steps/Steps.kt";

function createDocument(text, languageId, fsPath) {
  const lines = text.split(/\r?\n/);
  return {
    fileName: fsPath,
    languageId,
    lineCount: lines.length,
    uri: {
      fsPath,
      path: fsPath,
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

function createFakeVscode(textDocuments) {
  return {
    CodeLens: class CodeLens {
      constructor(range, command) {
        this.range = range;
        this.command = command;
      }
    },
    Location: class Location {
      constructor(uri, range) {
        this.uri = uri;
        this.range = range;
      }
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
    Uri: {
      file(fsPath) {
        return { fsPath, path: fsPath, toString: () => `file://${fsPath}` };
      },
    },
    WorkspaceEdit: class WorkspaceEdit {
      constructor() {
        this.replacements = [];
      }

      replace(uri, range, newText) {
        this.replacements.push({ uri, range, newText });
      }
    },
    languages: {
      createDiagnosticCollection: () => ({
        set() {},
        delete() {},
        dispose() {},
      }),
    },
    window: {},
    workspace: {
      textDocuments,
      getConfiguration: () => ({ get: () => undefined }),
      async saveAll() {
        return true;
      },
    },
  };
}

function createProjectFactory() {
  return {
    getGaugeRootFromFilePath(filename) {
      if (!String(filename).startsWith("/workspace/gauge/")) {
        throw new Error("not a Gauge project file");
      }
      return "/workspace/gauge";
    },
    isGaugeProject() {
      return true;
    },
  };
}

function kotlinSource(annotation) {
  return [
    "package steps",
    "",
    "import com.thoughtworks.gauge.Step",
    "",
    "class Steps {",
    `  @Step("${annotation}")`,
    "  fun implementation() {}",
    "}",
  ].join("\n");
}

// Everything a user can observe about "does this annotation implement this
// step?", asked of each module in turn.
async function surfacesFor(specLines, annotation, stepLine) {
  const specDocument = createDocument(specLines.join("\n"), "gauge", SPEC_PATH);
  const kotlinDocument = createDocument(kotlinSource(annotation), "kotlin", KOTLIN_PATH);
  const documents = [specDocument, kotlinDocument];
  const vscode = createFakeVscode(documents);

  const diagnostics = new GaugeStepDiagnosticsProvider({ vscode: createFakeVscode(documents) })
    .provideDiagnostics(specDocument, documents)
    .map((diagnostic) => diagnostic.message);

  const definitions = await new GaugeStepDefinitionProvider({
    projectFactory: createProjectFactory(),
    vscode,
  }).provideDefinition(specDocument, { line: stepLine, character: 4 });

  const lenses = await new GaugeCodeLensProvider({
    projectFactory: createProjectFactory(),
    vscode,
  }).provideCodeLenses(kotlinDocument);

  const edit = await new GaugeRenameProvider({ vscode })
    .provideRenameEdits(kotlinDocument, { line: 5, character: 12 }, `${annotation} renamed`);

  return {
    // The diagnostics module's verdict.
    undefinedStep: diagnostics.includes("Undefined Step"),
    // Go to Definition's verdict.
    definitions: (definitions || []).length,
    // The Kotlin-side reference count.
    references: (lenses || [])
      .map((lens) => lens.command && lens.command.title)
      .filter((title) => typeof title === "string" && title.includes("reference")),
    // Whether a rename of the annotation reaches the specification.
    renamesSpec: (edit && edit.replacements ? edit.replacements : [])
      .some((replacement) => replacement.uri.fsPath === SPEC_PATH),
  };
}

// A shape the runner CAN match: every surface must say so.
async function assertImplemented(label, specLines, annotation, stepLine) {
  const surfaces = await surfacesFor(specLines, annotation, stepLine);
  assert.deepEqual(surfaces, {
    undefinedStep: false,
    definitions: 1,
    references: ["1 reference(s)"],
    renamesSpec: true,
  }, `${label}: every surface must agree the step IS implemented`);
}

// A shape the runner CANNOT match: every surface must say so too. Reporting it
// implemented is worse than reporting it undefined, because the editor then
// suppresses the runner's correct verdict.
async function assertUnimplemented(label, specLines, annotation, stepLine) {
  const surfaces = await surfacesFor(specLines, annotation, stepLine);
  assert.deepEqual(surfaces, {
    undefinedStep: true,
    definitions: 0,
    references: ["0 reference(s)"],
    renamesSpec: false,
  }, `${label}: every surface must agree the step is NOT implemented`);
}

const HEAD = ["# Agreement", "", "## Scenario", ""];

test("every step surface agrees for a plain step", async () => {
  await assertImplemented("plain", [...HEAD, "* Confirm order"], "Confirm order", 4);
  await assertUnimplemented("plain mismatch", [...HEAD, "* Confirm order"], "Cancel order", 4);
});

// The runner keys its registry on StepsUtil.getStepText, which replaces only
// <...>. A quoted run therefore stays literal in an annotation while the SPEC
// grammar reads it as an argument, so `@Step("the user \"admin\" logs in")`
// registers `the user "admin" logs in` and can never match the step value
// `the user {} logs in`.
test("every step surface agrees about a quoted literal in the annotation", async () => {
  await assertUnimplemented(
    "quoted literal",
    [...HEAD, "* the user \"admin\" logs in"],
    "the user \\\"admin\\\" logs in",
    4,
  );
  await assertImplemented(
    "quoted parameter",
    [...HEAD, "* the user \"admin\" logs in"],
    "the user <name> logs in",
    4,
  );
});

// StepsUtil performs no escape processing, so braces are ordinary characters in
// an annotation, while a specification must write them "\{". The two sides
// therefore spell the same key differently, and each must use its own grammar.
test("every step surface agrees about braces in the annotation", async () => {
  await assertImplemented(
    "escaped braces",
    [...HEAD, "* cost is \\{5\\}"],
    "cost is {5}",
    4,
  );
  await assertUnimplemented(
    "annotation keeps the spec escapes",
    [...HEAD, "* cost is \\{5\\}"],
    "cost is \\\\{5\\\\}",
    4,
  );
});

// A step may carry a doc string AND an inline table, and both are arguments, so
// the step value gains the table's "{}" while the doc string adds none.
test("every step surface agrees about a doc string followed by a table", async () => {
  const lines = [...HEAD, "* Load the payload", "\"\"\"", "body", "\"\"\"", "|id|", "|--|", "|1 |"];
  await assertImplemented("doc string then table", lines, "Load the payload <table>", 4);
  await assertUnimplemented("doc string then table, no table arg", lines, "Load the payload", 4);
});

// The fence must open on the line immediately after the step. A blank line
// before it detaches the doc string AND the table, so the step takes no
// arguments at all.
test("every step surface agrees when a blank line detaches the doc string", async () => {
  const lines = [...HEAD, "* Load the payload", "", "\"\"\"", "body", "\"\"\"", "|id|", "|--|", "|1 |"];
  await assertImplemented("blank then doc string", lines, "Load the payload", 4);
  await assertUnimplemented("blank then doc string, table arg", lines, "Load the payload <table>", 4);
});

// isTableRow tests the first and last characters, so a row needs a closing pipe
// and a lone "|" is a row - both indices are the same character.
test("every step surface agrees about an unclosed table row", async () => {
  const lines = [...HEAD, "* Pay the total amount", "|a", "|1"];
  await assertImplemented("unclosed row is a comment", lines, "Pay the total amount", 4);
  await assertUnimplemented("unclosed row is not a table", lines, "Pay the total amount <table>", 4);
});

test("every step surface agrees about a bare pipe table row", async () => {
  const lines = [...HEAD, "* Pay the total amount", "|", "|1|"];
  await assertImplemented("bare pipe is a row", lines, "Pay the total amount <table>", 4);
  await assertUnimplemented("bare pipe is not a comment", lines, "Pay the total amount", 4);
});

test("directory aliases agree on project membership across step surfaces", async (t) => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { createProjectFactory: realProjectFactory } = require("../src/project/projectFactory");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "gauge-scope-alias-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const root = path.join(fs.realpathSync(temporary), "physical");
  const alias = path.join(temporary, "alias");
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "manifest.json"), '{"Language":"java"}');
  fs.symlinkSync(root, alias, process.platform === "win32" ? "junction" : "dir");
  const factory = realProjectFactory();
  t.after(() => factory.dispose());
  // The real Gauge runner executes this annotation through either directory
  // spelling. File identity must not split its editor project membership.
  const spec = createDocument("# Agreement\n\n## Scenario\n\n* Known step\n", "gauge", path.join(root, "agreement.spec"));
  const kotlin = createDocument(kotlinSource("Known step"), "kotlin", path.join(alias, "Steps.kt"));
  const documents = [spec, kotlin];
  require("../src/workspaceDocumentStore").markWorkspaceStepImplementationScanComplete(documents);
  const vscode = createFakeVscode(documents);
  const options = { vscode, projectFactory: factory };
  const diagnostics = new GaugeStepDiagnosticsProvider(options).provideDiagnostics(spec, documents);
  const definitions = await new GaugeStepDefinitionProvider(options).provideDefinition(spec, { line: 4, character: 5 });
  const lenses = await new GaugeCodeLensProvider(options).provideCodeLenses(kotlin);
  const edit = await new GaugeRenameProvider(options).provideRenameEdits(kotlin, { line: 5, character: 12 }, "Renamed step");
  assert.deepEqual({
    undefinedStep: diagnostics.some((item) => item.message === "Undefined Step"),
    definitions: (definitions || []).length,
    references: lenses.filter((item) => item.command?.title?.includes("reference")).map((item) => item.command.title),
    renamesSpec: (edit?.replacements || []).some((item) => item.uri.fsPath === spec.uri.fsPath),
  }, { undefinedStep: false, definitions: 1, references: ["1 reference(s)"], renamesSpec: true });

  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const { WorkspaceStepIndex } = require("../src/workspaceStepIndex");
  const aliasSpec = createDocument(spec.getText(), "gauge", path.join(alias, "agreement.spec"));
  const physicalKotlin = createDocument(kotlin.getText(), "kotlin", path.join(root, "Steps.kt"));
  documents.push(aliasSpec, physicalKotlin);
  const store = new WorkspaceDocumentStore(options);
  t.after(() => store.dispose());
  const index = new WorkspaceStepIndex({ ...options, documentStore: store });
  t.after(() => index.dispose());
  assert.equal((await index.definitionEntries(aliasSpec, ["Known step"])).length, 1);
  assert.equal(await index.referenceCount(physicalKotlin, "Known step"), 1);
  assert.equal((await index.stepEntriesForDocument(aliasSpec, physicalKotlin)).length, 1);
  assert.deepEqual(new GaugeStepDiagnosticsProvider(options).provideDiagnostics(physicalKotlin, store.documents()), []);
});

test("imported source membership agrees across disk and open-document consumers", async () => {
  // getgauge/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/StepUtil.java
  // searches IDE source scope: IDEA 2020.1 excludes content-only Kotlin files.
  // Kotlin LSP 0.0.12 exportWorkspace and workspace/symbol also exclude notes.
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const { WorkspaceStepIndex } = require("../src/workspaceStepIndex");
  const spec = createDocument("# Scope\n\n## Example\n\n* source\n* notes", "gauge", SPEC_PATH);
  const source = createDocument(kotlinSource("source"), "kotlin", KOTLIN_PATH);
  const notes = createDocument(kotlinSource("notes"), "kotlin", "/workspace/gauge/notes/Notes.kt");
  for (const document of [spec, source, notes]) document.uri.scheme = "file";
  const vscode = createFakeVscode([spec, source, notes]);
  vscode.commands = { registerCommand: () => ({ dispose() {} }) };
  vscode.languages.registerReferenceProvider = () => ({ dispose() {} });
  const projectFactory = createProjectFactory();
  let includeNotes = false;
  let changed;
  const sourceScope = {
    allows(file) { return !file.endsWith("/notes/Notes.kt") || includeNotes; },
    onDidChange(listener) { changed = listener; return { dispose() {} }; },
  };
  vscode.workspace.findFiles = async () => [spec.uri, source.uri, notes.uri];
  const files = new Map([spec, source, notes].map((document) => [document.uri.fsPath, document.getText()]));
  const fileSystem = { promises: { readFile: async (file) => files.get(file) } };
  const store = new WorkspaceDocumentStore({ sourceScope, vscode, projectFactory, fileSystem });
  await store.start();
  const options = { documentStore: store, vscode, projectFactory };
  const diagnostics = new GaugeStepDiagnosticsProvider(options);
  const definitions = new GaugeStepDefinitionProvider(options);
  const lenses = new GaugeCodeLensProvider(options);
  const rename = new GaugeRenameProvider(options);
  const { ReferenceProvider } = require("../src/gaugeReference");
  const { GaugeClients } = require("../src/gaugeClients");
  const references = new ReferenceProvider(new GaugeClients(), options);
  const index = new WorkspaceStepIndex(options);
  index.start();
  try {
    for (const [allowed, open] of [[false, false], [false, true], [true, false], [true, true], [false, true]]) {
      vscode.workspace.textDocuments = [spec, source, ...(open ? [notes] : [])];
      includeNotes = allowed;
      if (changed) changed();
      const messages = diagnostics.provideDiagnostics(spec, [spec, source, notes]);
      const locations = await definitions.provideDefinition(spec, { line: 5, character: 4 });
      const sourceLocations = await definitions.provideDefinition(spec, { line: 4, character: 4 });
      const noteLenses = await lenses.provideCodeLenses(notes);
      const noteEdit = await rename.provideRenameEdits(notes, { line: 5, character: 12 }, "notes renamed");
      const entries = await index.definitionEntries(spec, ["notes"]);
      const noteReferences = await references.provideReferences(notes, { line: 5, character: 12 });
      assert.deepEqual({
        undefinedNotes: messages.some((entry) => entry.message === "Undefined Step" && entry.range.start.line === 5),
        definitions: (locations || []).length,
        sourceDefinitions: (sourceLocations || []).length,
        referenceLenses: (noteLenses || []).filter((lens) => lens.command?.title.includes("reference")).length,
        renamesSpec: Boolean(noteEdit?.replacements.some((entry) => entry.uri.fsPath === SPEC_PATH)),
        indexedNotes: entries.length,
        cachedNotes: store.documents().some((document) => document.uri.fsPath === notes.uri.fsPath),
        references: (noteReferences || []).length,
      }, {
        undefinedNotes: !allowed,
        definitions: Number(allowed),
        sourceDefinitions: 1,
        referenceLenses: Number(allowed),
        renamesSpec: allowed,
        indexedNotes: Number(allowed),
        cachedNotes: allowed,
        references: Number(allowed),
      });
    }
  } finally {
    index.dispose();
    store.dispose();
    definitions.dispose();
    lenses.dispose();
    rename.dispose();
    references.dispose();
  }
});

test("imported dependencies agree across consumer projects and reverse references", async () => {
  // getgauge/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/StepUtil.java
  // uses module dependencies including tests. Real IDEA 2020.1 and Kotlin LSP
  // 0.0.12 distinguish exported transitive edges from private/runtime edges.
  const fs = require("node:fs/promises");
  const path = require("node:path");
  const { KotlinSourceScope } = require("../src/kotlinSourceScope");
  const { WorkspaceDocumentStore } = require("../src/workspaceDocumentStore");
  const { WorkspaceStepIndex } = require("../src/workspaceStepIndex");
  const { ReferenceProvider } = require("../src/gaugeReference");
  const { GaugeClients } = require("../src/gaugeClients");
  const roots = ["/workspace/gauge", "/workspace/consumer", "/workspace/unrelated", "/shared/beta", "/shared/gamma"];
  const specs = roots.slice(0, 3).map((root) => createDocument("# Modules\n\n## Example\n\n* beta\n* gamma", "gauge", `${root}/specs/example.spec`));
  const implementations = roots.map((root, index) => createDocument(kotlinSource(["alpha", "consumer", "unrelated", "beta", "gamma"][index]), "kotlin", `${root}/src/Steps.kt`));
  const documents = [...specs, ...implementations];
  for (const document of documents) document.uri.scheme = "file";
  const beta = implementations[3];
  const vscode = createFakeVscode([specs[0]]);
  vscode.Uri.parse = (value) => vscode.Uri.file(require("node:url").fileURLToPath(value));
  let exported = false;
  let consumeAlpha = true;
  let gammaScope = "compile";
  const modules = () => roots.map((root, index) => ({
    name: String(index),
    contentRoots: [{ path: root, sourceRoots: [{ path: `${root}/src`, type: "java-test" }] }],
    dependencies: index === 0 && consumeAlpha || index === 1
      ? [{ type: "module", name: "3", scope: index === 0 ? "compile" : "test" }]
      : index === 3 ? [{ type: "module", name: "4", scope: gammaScope, isExported: exported }] : [],
  }));
  vscode.extensions = { getExtension: () => ({ isActive: true }) };
  vscode.commands = {
    registerCommand: () => ({ dispose() {} }),
    getCommands: async () => ["exportWorkspace"],
    executeCommand: async (_command, directory) => fs.writeFile(path.join(directory, "workspace.json"), JSON.stringify({ modules: modules() })),
  };
  vscode.languages.registerReferenceProvider = () => ({ dispose() {} });
  vscode.RelativePattern = class { constructor(base, pattern) { this.base = typeof base === "string" ? base : base.fsPath; this.pattern = pattern; } };
  vscode.workspace.findFiles = async (pattern) => documents.filter((document) => typeof pattern === "string"
    ? document.uri.fsPath.startsWith("/workspace/")
    : document.uri.fsPath.startsWith(`${pattern.base}/`)).map((document) => document.uri);
  const projectFactory = {
    getGaugeRootFromFilePath: (file) => roots.slice(0, 3).find((root) => file.startsWith(`${root}/`)),
    isGaugeProject: (root) => roots.slice(0, 3).includes(root),
  };
  const fileSystem = { promises: { readFile: async (file) => documents.find((document) => document.uri.fsPath === file).getText() } };
  const scope = new KotlinSourceScope({ vscode });
  await scope.refresh();
  const store = new WorkspaceDocumentStore({ vscode, sourceScope: scope, projectFactory, fileSystem });
  await store.start();
  const options = { vscode, documentStore: store, projectFactory, fileSystem };
  const diagnostics = new GaugeStepDiagnosticsProvider(options);
  const index = new WorkspaceStepIndex({ ...options, diagnosticsProvider: diagnostics });
  index.start();
  options.workspaceStepIndex = index;
  const definition = new GaugeStepDefinitionProvider(options);
  const references = new ReferenceProvider(new GaugeClients(), options);
  const lenses = new GaugeCodeLensProvider(options);
  const rename = new GaugeRenameProvider(options);
  try {
    for (const phase of ["private", "exported", "runtime", "removed"]) {
      exported = phase !== "private";
      gammaScope = phase === "runtime" ? "runtime" : "compile";
      consumeAlpha = phase !== "removed";
      await scope.refresh();
      await store.whenReady();
      const targets = await definition.provideDefinition(specs[0], { line: 4, character: 4 });
      const gamma = await definition.provideDefinition(specs[0], { line: 5, character: 4 });
      const unrelated = await definition.provideDefinition(specs[2], { line: 4, character: 4 });
      const refs = await references.provideReferences(beta, { line: 5, character: 12 });
      const codeLenses = await lenses.provideCodeLenses(beta);
      const edits = await rename.provideRenameEdits(beta, { line: 5, character: 12 }, "beta renamed");
      const expectedSpecs = specs.slice(consumeAlpha ? 0 : 1, 2).map((document) => document.uri.fsPath).sort();
      assert.deepEqual((targets || []).map((entry) => entry.uri.fsPath), consumeAlpha ? [beta.uri.fsPath] : []);
      assert.equal((gamma || []).length, Number(phase === "exported"));
      assert.deepEqual(unrelated || [], []);
      assert.deepEqual((refs || []).map((entry) => entry.uri.fsPath).sort(), expectedSpecs);
      assert.deepEqual((codeLenses || []).map((entry) => entry.command?.title).filter((title) => title?.includes("reference")), [`${expectedSpecs.length} reference(s)`]);
      assert.deepEqual(edits.replacements.filter((entry) => entry.uri.fsPath.endsWith(".spec")).map((entry) => entry.uri.fsPath).sort(), expectedSpecs);
      assert.equal(diagnostics.provideDiagnostics(specs[0], store.documents()).some((entry) => entry.message === "Undefined Step" && entry.range.start.line === 4), !consumeAlpha);
    }
  } finally {
    for (const disposable of [rename, lenses, references, definition, index, store, scope]) disposable.dispose();
  }
});
