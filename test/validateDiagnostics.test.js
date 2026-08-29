const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

function createFakeVscode(options = {}) {
  return {
    Diagnostic: class Diagnostic {
      constructor(range, message, severity) {
        this.range = range;
        this.message = message;
        this.severity = severity;
      }
    },
    DiagnosticSeverity: {
      Error: "error",
      Warning: "warning",
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
    workspace: {
      getConfiguration(section) {
        assert.equal(section, "gauge");
        return {
          get(key) {
            return key === "home" ? options.gaugeHome : "";
          },
        };
      },
    },
  };
}

function createDocument(text, fsPath = "/workspace/gauge/specs/example.spec", languageId = "gauge") {
  return {
    languageId,
    uri: { fsPath },
    getText() {
      return text;
    },
  };
}

test("GaugeValidateDiagnosticsProvider maps gauge validate output for the current document", () => {
  const { GaugeValidateDiagnosticsProvider } = require("../src/validateDiagnostics");

  const spawnCalls = [];
  const command = {
    spawnSync(args, options) {
      spawnCalls.push({ args, options });
      return {
        stdout: Buffer.from([
          "ParseError /workspace/gauge/specs/example.spec:3: Step is malformed",
          "ValidationError /workspace/gauge/specs/other.spec:2: Other file error",
          "This line is not a Gauge validation error",
          "",
        ].join("\n")),
        stderr: Buffer.from(""),
      };
    },
  };
  const cli = {
    gaugeCommand() {
      return command;
    },
  };
  const project = {
    root() {
      return "/workspace/gauge";
    },
    envs(receivedCli) {
      assert.equal(receivedCli, cli);
      return { GAUGE_CUSTOM_CLASSPATH: "/workspace/gauge/build/classes" };
    },
  };
  const projectFactory = {
    getProjectByFilepath(filename) {
      assert.equal(filename, "/workspace/gauge/specs/example.spec");
      return project;
    },
  };
  const provider = new GaugeValidateDiagnosticsProvider({
    cli,
    env: { PATH: "/bin" },
    projectFactory,
    vscode: createFakeVscode(),
  });
  const document = createDocument([
    "# Example",
    "",
    "* malformed",
    "",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(spawnCalls, [
    {
      args: ["validate"],
      options: {
        cwd: "/workspace/gauge",
        env: {
          PATH: "/bin",
          GAUGE_CUSTOM_CLASSPATH: "/workspace/gauge/build/classes",
        },
      },
    },
  ]);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].message, "ParseError line number: 3, Step is malformed");
  assert.equal(diagnostics[0].severity, "error");
  assert.equal(diagnostics[0].source, "gauge");
  assert.equal(diagnostics[0].code, "gauge.validate");
  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 2, character: 0 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 2, character: 11 });
});

test("GaugeValidateDiagnosticsProvider retries an unavailable JVM classpath without false errors", async () => {
  const { GaugeValidateDiagnosticsProvider } = require("../src/validateDiagnostics");

  const spawnEnvironments = [];
  const command = {
    spawnSync(_args, options) {
      spawnEnvironments.push(options.env);
      return {
        stdout: Buffer.from(options.env.gauge_custom_classpath
          ? ""
          : "ValidationError /workspace/gauge/specs/example.spec:2 Step implementation not found"),
        stderr: Buffer.from(""),
      };
    },
  };
  let environmentCalls = 0;
  const project = {
    root() {
      return "/workspace/gauge";
    },
    language() {
      return "java";
    },
    envs() {
      environmentCalls += 1;
      return environmentCalls === 1
        ? {}
        : { gauge_custom_classpath: "/workspace/gauge/target/test-classes" };
    },
  };
  const provider = new GaugeValidateDiagnosticsProvider({
    cli: { gaugeCommand: () => command },
    env: { PATH: "/bin" },
    projectFactory: {
      getProjectByFilepath() {
        return project;
      },
    },
    vscode: createFakeVscode(),
  });
  const document = createDocument("# Example\n* A project Step");

  assert.deepEqual(await provider.provideDiagnosticsAsync(document, new Map()), []);
  assert.deepEqual(await provider.provideDiagnosticsAsync(document, new Map()), []);
  assert.equal(environmentCalls, 2);
  assert.deepEqual(spawnEnvironments, [{
    PATH: "/bin",
    gauge_custom_classpath: "/workspace/gauge/target/test-classes",
  }]);
});

test("GaugeValidateDiagnosticsProvider maps parse warnings to warning diagnostics", () => {
  const { GaugeValidateDiagnosticsProvider } = require("../src/validateDiagnostics");

  const command = {
    spawnSync() {
      return {
        stdout: Buffer.from(
          "[ParseWarning] /workspace/gauge/specs/example.spec:2: Dynamic param <name> could not be resolved",
        ),
        stderr: Buffer.from(""),
      };
    },
  };
  const provider = new GaugeValidateDiagnosticsProvider({
    cli: {
      gaugeCommand() {
        return command;
      },
    },
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/gauge/specs/example.spec");
        return "/workspace/gauge";
      },
    },
    vscode: createFakeVscode(),
  });
  const document = createDocument([
    "# Example",
    "* Use <name>",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.equal(diagnostics.length, 1);
  assert.equal(
    diagnostics[0].message,
    "[ParseWarning] line number: 2, Dynamic param <name> could not be resolved",
  );
  assert.equal(diagnostics[0].severity, "warning");
});

test("GaugeValidateDiagnosticsProvider maps gauge validate output for markdown specs", () => {
  const { GaugeValidateDiagnosticsProvider } = require("../src/validateDiagnostics");

  const spawnCalls = [];
  const command = {
    spawnSync(args, options) {
      spawnCalls.push({ args, options });
      return {
        stdout: Buffer.from("ParseError /workspace/gauge/specs/example.md:3: Step is malformed"),
        stderr: Buffer.from(""),
      };
    },
  };
  const cli = {
    gaugeCommand() {
      return command;
    },
  };
  const project = {
    root() {
      return "/workspace/gauge";
    },
  };
  const projectFactory = {
    getProjectByFilepath(filename) {
      assert.equal(filename, "/workspace/gauge/specs/example.md");
      return project;
    },
  };
  const provider = new GaugeValidateDiagnosticsProvider({
    cli,
    env: { PATH: "/bin" },
    projectFactory,
    vscode: createFakeVscode(),
  });
  const document = createDocument([
    "# Example",
    "",
    "* malformed",
    "",
  ].join("\n"), "/workspace/gauge/specs/example.md", "markdown");

  const diagnostics = provider.provideDiagnostics(document);

  assert.equal(spawnCalls.length, 1);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].message, "ParseError line number: 3, Step is malformed");
});

test("GaugeValidateDiagnosticsProvider ignores Markdown when the resolved root is not a Gauge project", () => {
  const { GaugeValidateDiagnosticsProvider } = require("../src/validateDiagnostics");

  const spawnCalls = [];
  const provider = new GaugeValidateDiagnosticsProvider({
    cli: {
      gaugeCommand() {
        return {
          spawnSync(args, options) {
            spawnCalls.push({ args, options });
            throw new Error("should not spawn");
          },
        };
      },
    },
    env: { PATH: "/bin" },
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/notes/example.md");
        return "/workspace/notes";
      },
      isGaugeProject(root) {
        assert.equal(root, "/workspace/notes");
        return false;
      },
    },
    vscode: createFakeVscode(),
  });
  const document = createDocument([
    "# Notes",
    "",
    "* not a Gauge step",
    "",
  ].join("\n"), "/workspace/notes/example.md", "markdown");

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(spawnCalls, []);
});

test("GaugeValidateDiagnosticsProvider maps gauge validate output for concept files", () => {
  const { GaugeValidateDiagnosticsProvider } = require("../src/validateDiagnostics");

  const spawnCalls = [];
  const command = {
    spawnSync(args, options) {
      spawnCalls.push({ args, options });
      return {
        stdout: Buffer.from("ParseError /workspace/gauge/specs/shared.cpt:3: Step is malformed"),
        stderr: Buffer.from(""),
      };
    },
  };
  const cli = {
    gaugeCommand() {
      return command;
    },
  };
  const project = {
    root() {
      return "/workspace/gauge";
    },
  };
  const projectFactory = {
    getProjectByFilepath(filename) {
      assert.equal(filename, "/workspace/gauge/specs/shared.cpt");
      return project;
    },
  };
  const provider = new GaugeValidateDiagnosticsProvider({
    cli,
    env: { PATH: "/bin" },
    projectFactory,
    vscode: createFakeVscode(),
  });
  const document = createDocument([
    "# Shared concept",
    "",
    "* malformed",
    "",
  ].join("\n"), "/workspace/gauge/specs/shared.cpt", "plaintext");

  const diagnostics = provider.provideDiagnostics(document);

  assert.equal(spawnCalls.length, 1);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].message, "ParseError line number: 3, Step is malformed");
});

test("GaugeValidateDiagnosticsProvider maps gauge validate output for gauge-concept documents by language id", () => {
  const { GaugeValidateDiagnosticsProvider } = require("../src/validateDiagnostics");

  const spawnCalls = [];
  const command = {
    spawnSync(args, options) {
      spawnCalls.push({ args, options });
      return {
        stdout: Buffer.from("ParseError /workspace/gauge/specs/shared:3: Step is malformed"),
        stderr: Buffer.from(""),
      };
    },
  };
  const cli = {
    gaugeCommand() {
      return command;
    },
  };
  const project = {
    root() {
      return "/workspace/gauge";
    },
  };
  const projectFactory = {
    getProjectByFilepath(filename) {
      assert.equal(filename, "/workspace/gauge/specs/shared");
      return project;
    },
  };
  const provider = new GaugeValidateDiagnosticsProvider({
    cli,
    env: { PATH: "/bin" },
    projectFactory,
    vscode: createFakeVscode(),
  });
  const document = createDocument([
    "# Shared concept",
    "",
    "* malformed",
    "",
  ].join("\n"), "/workspace/gauge/specs/shared", "gauge-concept");

  const diagnostics = provider.provideDiagnostics(document);

  assert.equal(spawnCalls.length, 1);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].message, "ParseError line number: 3, Step is malformed");
});

test("GaugeValidateDiagnosticsProvider passes configured GAUGE_HOME to gauge validate", () => {
  const { GaugeValidateDiagnosticsProvider } = require("../src/validateDiagnostics");

  const spawnCalls = [];
  const command = {
    spawnSync(args, options) {
      spawnCalls.push({ args, options });
      return {
        stdout: Buffer.from(""),
        stderr: Buffer.from(""),
      };
    },
  };
  const cli = {
    gaugeCommand() {
      return command;
    },
  };
  const project = {
    root() {
      return "/workspace/gauge";
    },
  };
  const projectFactory = {
    getProjectByFilepath(filename) {
      assert.equal(filename, "/workspace/gauge/specs/example.spec");
      return project;
    },
  };
  const provider = new GaugeValidateDiagnosticsProvider({
    cli,
    env: { PATH: "/bin" },
    projectFactory,
    vscode: createFakeVscode({ gaugeHome: "/custom/gauge-home" }),
  });
  const document = createDocument([
    "# Example",
    "",
    "* passing",
    "",
  ].join("\n"));

  provider.provideDiagnostics(document);

  assert.deepEqual(spawnCalls, [
    {
      args: ["validate"],
      options: {
        cwd: "/workspace/gauge",
        env: {
          PATH: "/bin",
          GAUGE_HOME: "/custom/gauge-home",
        },
      },
    },
  ]);
});

test("GaugeValidateDiagnosticsProvider trims validation ranges to line content", () => {
  const { GaugeValidateDiagnosticsProvider } = require("../src/validateDiagnostics");

  const command = {
    spawnSync() {
      return {
        stdout: Buffer.from("ParseError /workspace/gauge/specs/example.spec:3: Step is malformed"),
        stderr: Buffer.from(""),
      };
    },
  };
  const provider = new GaugeValidateDiagnosticsProvider({
    cli: {
      gaugeCommand() {
        return command;
      },
    },
    projectFactory: {
      getProjectByFilepath() {
        return {
          root() {
            return "/workspace/gauge";
          },
        };
      },
    },
    vscode: createFakeVscode(),
  });
  const document = createDocument([
    "# Example",
    "",
    "  * malformed  ",
  ].join("\n"));

  const diagnostics = provider.provideDiagnostics(document);

  assert.deepEqual({ ...diagnostics[0].range.start }, { line: 2, character: 2 });
  assert.deepEqual({ ...diagnostics[0].range.end }, { line: 2, character: 13 });
});

test("GaugeValidateDiagnosticsProvider refreshes unopened workspace specs", async () => {
  const { GaugeValidateDiagnosticsProvider } = require("../src/validateDiagnostics");

  const sets = [];
  const spawnCalls = [];
  const command = {
    spawnSync(args, options) {
      spawnCalls.push({ args, options });
      return {
        stdout: Buffer.from("ParseError specs/unopened.spec:3: Step is malformed"),
        stderr: Buffer.from(""),
      };
    },
  };
  const cli = {
    gaugeCommand() {
      return command;
    },
  };
  const project = {
    root() {
      return "/workspace/gauge";
    },
    envs() {
      return {};
    },
  };
  const uri = { fsPath: "/workspace/gauge/specs/unopened.spec" };
  const fakeVscode = {
    ...createFakeVscode(),
    workspace: {
      textDocuments: [],
      findFiles(pattern) {
        assert.equal(pattern, "**/*.{spec,md,cpt}");
        return Promise.resolve([uri]);
      },
      openTextDocument(openedUri) {
        assert.equal(openedUri, uri);
        return Promise.resolve(createDocument([
          "# Example",
          "",
          "* malformed",
        ].join("\n"), uri.fsPath));
      },
    },
  };
  const provider = new GaugeValidateDiagnosticsProvider({
    cli,
    env: { PATH: "/bin" },
    projectFactory: {
      getProjectByFilepath(filename) {
        assert.equal(filename, uri.fsPath);
        return project;
      },
    },
    vscode: fakeVscode,
  });

  await provider.refreshDocuments({
    set(targetUri, diagnostics) {
      sets.push({ diagnostics, uri: targetUri });
    },
  });

  assert.deepEqual(spawnCalls, [
    {
      args: ["validate"],
      options: {
        cwd: "/workspace/gauge",
        env: { PATH: "/bin" },
      },
    },
  ]);
  assert.equal(sets.length, 1);
  assert.deepEqual(sets[0].uri, uri);
  assert.equal(sets[0].diagnostics[0].message, "ParseError line number: 3, Step is malformed");
  assert.deepEqual({ ...sets[0].diagnostics[0].range.start }, { line: 2, character: 0 });
  assert.deepEqual({ ...sets[0].diagnostics[0].range.end }, { line: 2, character: 11 });
});

test("GaugeValidateDiagnosticsProvider does not open unopened files outside Gauge projects during refresh", async () => {
  const { GaugeValidateDiagnosticsProvider } = require("../src/validateDiagnostics");

  const opened = [];
  const sets = [];
  const spawnCalls = [];
  const nonGaugeUri = { fsPath: "/workspace/notes/example.md" };
  const fakeVscode = {
    ...createFakeVscode(),
    workspace: {
      textDocuments: [],
      findFiles(pattern) {
        assert.equal(pattern, "**/*.{spec,md,cpt}");
        return Promise.resolve([nonGaugeUri]);
      },
      openTextDocument(uri) {
        opened.push(uri.fsPath);
        return Promise.resolve(createDocument([
          "# Notes",
          "",
          "* not a Gauge step",
        ].join("\n"), uri.fsPath, "markdown"));
      },
    },
  };
  const provider = new GaugeValidateDiagnosticsProvider({
    cli: {
      gaugeCommand() {
        return {
          spawnSync(args, options) {
            spawnCalls.push({ args, options });
            throw new Error("should not spawn");
          },
        };
      },
    },
    env: { PATH: "/bin" },
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, nonGaugeUri.fsPath);
        return "/workspace/notes";
      },
      isGaugeProject(root) {
        assert.equal(root, "/workspace/notes");
        return false;
      },
    },
    vscode: fakeVscode,
  });

  await provider.refreshDocuments({
    set(uri, diagnostics) {
      sets.push({ diagnostics, uri });
    },
  });

  assert.deepEqual(opened, []);
  assert.deepEqual(sets, []);
  assert.deepEqual(spawnCalls, []);
});

test("GaugeValidateDiagnosticsProvider registration does not schedule automatic validation", async () => {
  const { GaugeValidateDiagnosticsProvider } = require("../src/validateDiagnostics");
  const document = createDocument([
    "# Example",
    "",
    "* malformed",
  ].join("\n"));
  const opened = [];
  const saved = [];
  const closed = [];
  const sets = [];
  const deletes = [];
  const disposals = [];
  const spawnCalls = [];
  const fakeVscode = {
    ...createFakeVscode(),
    languages: {
      createDiagnosticCollection(name) {
        return {
          name,
          set(uri, diagnostics) {
            sets.push({ diagnostics, uri });
          },
          delete(uri) {
            deletes.push(uri);
          },
          dispose() {
            disposals.push(name);
          },
        };
      },
    },
    workspace: {
      textDocuments: [document],
      findFiles(pattern) {
        assert.equal(pattern, "**/*.{spec,md,cpt}");
        return Promise.resolve([]);
      },
      onDidOpenTextDocument(listener) {
        opened.push(listener);
        return { dispose() { disposals.push("open"); } };
      },
      onDidSaveTextDocument(listener) {
        saved.push(listener);
        return { dispose() { disposals.push("save"); } };
      },
      onDidCloseTextDocument(listener) {
        closed.push(listener);
        return { dispose() { disposals.push("close"); } };
      },
    },
  };
  const command = {
    spawnSync(args, options) {
      spawnCalls.push({ args, options });
      return {
        stdout: Buffer.from("ParseError /workspace/gauge/specs/example.spec:3: Step is malformed"),
        stderr: Buffer.from(""),
      };
    },
  };
  const provider = new GaugeValidateDiagnosticsProvider({
    cli: {
      gaugeCommand() {
        return command;
      },
    },
    env: { PATH: "/bin" },
    projectFactory: {
      getProjectByFilepath(filename) {
        assert.equal(filename, "/workspace/gauge/specs/example.spec");
        return {
          root() {
            return "/workspace/gauge";
          },
        };
      },
    },
    refreshDelayMs: 0,
    vscode: fakeVscode,
  });

  const disposable = provider.register();
  await provider.waitForPendingRefresh();
  disposable.dispose();

  assert.equal(opened.length, 0);
  assert.equal(saved.length, 0);
  assert.equal(closed.length, 0);
  assert.equal(spawnCalls.length, 0);
  assert.equal(sets.length, 0);
  assert.deepEqual(deletes, []);
  assert.deepEqual(disposals, ["gauge-validate"]);
});

test("GaugeValidateDiagnosticsProvider coalesces concurrent workspace refreshes", async () => {
  const { GaugeValidateDiagnosticsProvider } = require("../src/validateDiagnostics");
  let findCalls = 0;
  let resolveFiles;
  const files = new Promise((resolve) => {
    resolveFiles = resolve;
  });
  const provider = new GaugeValidateDiagnosticsProvider({
    cli: {
      gaugeCommand() {
        return undefined;
      },
    },
    vscode: {
      ...createFakeVscode(),
      workspace: {
        textDocuments: [],
        findFiles() {
          findCalls += 1;
          return files;
        },
        openTextDocument() {
          throw new Error("openTextDocument should not run");
        },
      },
    },
  });
  const collection = { set() {} };

  const first = provider.refreshDocuments(collection);
  const second = provider.refreshDocuments(collection);

  assert.equal(first, second);
  assert.equal(findCalls, 1);
  resolveFiles([]);
  await first;
});

test("GaugeValidateDiagnosticsProvider runs Gauge validation without blocking refresh", async () => {
  const { GaugeValidateDiagnosticsProvider } = require("../src/validateDiagnostics");
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const spawnCalls = [];
  const document = createDocument([
    "# Example",
    "",
    "* malformed",
  ].join("\n"));
  const provider = new GaugeValidateDiagnosticsProvider({
    cli: {
      gaugeCommand() {
        return {
          spawn(args, options) {
            spawnCalls.push({ args, options });
            return child;
          },
          spawnSync() {
            throw new Error("spawnSync should not run during workspace refresh");
          },
        };
      },
    },
    env: { PATH: "/bin" },
    projectFactory: {
      getProjectByFilepath() {
        return {
          root() {
            return "/workspace/gauge";
          },
          envs() {
            return {};
          },
        };
      },
    },
    vscode: {
      ...createFakeVscode(),
      workspace: {
        textDocuments: [document],
        findFiles() {
          return Promise.resolve([]);
        },
        openTextDocument() {
          throw new Error("openTextDocument should not run");
        },
      },
    },
  });
  const sets = [];
  const refresh = provider.refreshDocuments({
    set(uri, diagnostics) {
      sets.push({ diagnostics, uri });
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(spawnCalls, [
    {
      args: ["validate"],
      options: {
        cwd: "/workspace/gauge",
        env: { PATH: "/bin" },
      },
    },
  ]);
  assert.deepEqual(sets, []);

  child.stdout.emit(
    "data",
    Buffer.from("ParseError /workspace/gauge/specs/example.spec:3: Step is malformed"),
  );
  child.emit("close", 1);
  await refresh;

  assert.equal(sets.length, 1);
  assert.equal(sets[0].diagnostics[0].message, "ParseError line number: 3, Step is malformed");
});

test("parseGaugeValidateErrors accepts optional colon separators", () => {
  const { parseGaugeValidateErrors } = require("../src/validateDiagnostics");

  assert.deepEqual(parseGaugeValidateErrors([
    "ParseError /workspace/gauge/specs/example.spec:7 Missing heading",
    "ValidationError /workspace/gauge/specs/example.spec:9: Duplicate step",
    "not a validation error",
  ].join("\n")), [
    {
      type: "ParseError",
      fileName: "/workspace/gauge/specs/example.spec",
      lineNumber: 7,
      message: "Missing heading",
    },
    {
      type: "ValidationError",
      fileName: "/workspace/gauge/specs/example.spec",
      lineNumber: 9,
      message: "Duplicate step",
    },
  ]);
});

// references/gauge/validation/validate.go StepValidationError.Error formats
// "<file>:<lineNo> <message> => '<lineText>'", so the step's own text is part of
// the line. A greedy (.+) let a ":<digits> " inside that text - a URL port, a
// clock time - win over the real line number, so the diagnostic landed on a
// phantom file at a phantom line and the real spec showed nothing at all.
test("parseGaugeValidateErrors is not fooled by a port inside the step text", () => {
  const { parseGaugeValidateErrors } = require("../src/validateDiagnostics");

  assert.deepEqual(parseGaugeValidateErrors([
    "ValidationError /workspace/gauge/specs/example.spec:5 Step implementation not found"
    + " => 'open http://localhost:8080 and log in'",
    "ValidationError C:\\workspace\\specs\\example.spec:12 Duplicate step => 'at 10:30 do it'",
  ].join("\n")), [
    {
      type: "ValidationError",
      fileName: "/workspace/gauge/specs/example.spec",
      lineNumber: 5,
      message: "Step implementation not found => 'open http://localhost:8080 and log in'",
    },
    {
      type: "ValidationError",
      fileName: "C:\\workspace\\specs\\example.spec",
      lineNumber: 12,
      message: "Duplicate step => 'at 10:30 do it'",
    },
  ]);
});

function createScopedValidateFixture(options = {}) {
  const state = {
    deletes: [],
    findFilesCalls: 0,
    listeners: { close: [], open: [], save: [] },
    sets: [],
    spawnCalls: [],
  };
  const collection = {
    delete(uri) {
      state.deletes.push(uri);
    },
    dispose() {},
    set(uri, diagnostics) {
      state.sets.push({ diagnostics, uri });
    },
  };
  const documents = options.textDocuments || [];
  const fakeVscode = {
    ...createFakeVscode(),
    Uri: {
      file(fsPath) {
        return { fsPath };
      },
    },
    languages: {
      createDiagnosticCollection(name) {
        collection.name = name;
        return collection;
      },
    },
  };
  fakeVscode.workspace = {
    ...fakeVscode.workspace,
    textDocuments: documents,
    async findFiles() {
      state.findFilesCalls += 1;
      return [];
    },
    async openTextDocument() {
      throw new Error("openTextDocument should not run");
    },
    onDidOpenTextDocument(listener) {
      state.listeners.open.push(listener);
      return { dispose() {} };
    },
    onDidSaveTextDocument(listener) {
      state.listeners.save.push(listener);
      return { dispose() {} };
    },
    onDidCloseTextDocument(listener) {
      state.listeners.close.push(listener);
      return { dispose() {} };
    },
  };
  const command = {
    spawnSync(args, spawnOptions) {
      state.spawnCalls.push({ args, options: spawnOptions });
      return { stderr: Buffer.from(""), stdout: Buffer.from(options.validateOutput || "") };
    },
  };
  const provider = new (require("../src/validateDiagnostics").GaugeValidateDiagnosticsProvider)({
    cli: {
      gaugeCommand() {
        return command;
      },
    },
    env: { PATH: "/bin" },
    projectFactory: {
      get(root) {
        return { envs: () => ({}), root: () => root };
      },
      getGaugeRootFromFilePath(file) {
        const roots = options.roots || ["/workspace/gauge"];
        return roots.find((root) => file.startsWith(`${root}/`));
      },
      getProjectByFilepath(file) {
        const roots = options.roots || ["/workspace/gauge"];
        const root = roots.find((candidate) => file.startsWith(`${candidate}/`));
        return root ? { envs: () => ({}), root: () => root } : undefined;
      },
      isGaugeProject() {
        return true;
      },
    },
    refreshDelayMs: 0,
    vscode: fakeVscode,
  });
  return { collection, provider, state };
}

test("GaugeValidateDiagnosticsProvider manual root refresh does not rescan the workspace", async () => {
  const document = createDocument("# Example\n* step", "/workspace/gauge/specs/example.spec", "gauge");
  const { collection, provider, state } = createScopedValidateFixture({ textDocuments: [document] });

  provider.scheduleRootRefresh(collection, "/workspace/gauge");
  await provider.waitForPendingRefresh();

  assert.equal(state.findFilesCalls, 0);
});

test("GaugeValidateDiagnosticsProvider validates only the requested project root", async () => {
  const documentA = createDocument("# A\n* step", "/projects/alpha/specs/a.spec", "gauge");
  const documentB = createDocument("# B\n* step", "/projects/beta/specs/b.spec", "gauge");
  const { collection, provider, state } = createScopedValidateFixture({
    roots: ["/projects/alpha", "/projects/beta"],
    textDocuments: [documentA, documentB],
  });

  provider.scheduleRootRefresh(collection, "/projects/alpha");
  await provider.waitForPendingRefresh();

  assert.deepEqual(state.spawnCalls.map((call) => call.options.cwd), ["/projects/alpha"]);
});

test("GaugeValidateDiagnosticsProvider coalesces manual refresh bursts per root", async () => {
  const document = createDocument("# Example\n* step", "/workspace/gauge/specs/example.spec", "gauge");
  const { collection, provider, state } = createScopedValidateFixture({ textDocuments: [document] });

  provider.scheduleRootRefresh(collection, "/workspace/gauge");
  provider.scheduleRootRefresh(collection, "/workspace/gauge");
  provider.scheduleRootRefresh(collection, "/workspace/gauge");
  await provider.waitForPendingRefresh();

  assert.equal(state.spawnCalls.length, 1);
});

test("GaugeValidateDiagnosticsProvider attaches validate errors to unopened files", async () => {
  const document = createDocument("# Example\n* step", "/workspace/gauge/specs/example.spec", "gauge");
  const { collection, provider, state } = createScopedValidateFixture({
    textDocuments: [document],
    validateOutput: "ParseError /workspace/gauge/specs/closed.spec:3: Step is malformed",
  });

  provider.scheduleRootRefresh(collection, "/workspace/gauge");
  await provider.waitForPendingRefresh();

  const closedSet = state.sets.find((entry) => entry.uri && entry.uri.fsPath === "/workspace/gauge/specs/closed.spec");
  assert.notEqual(closedSet, undefined);
  assert.equal(closedSet.diagnostics.length, 1);
  assert.equal(closedSet.diagnostics[0].message, "ParseError line number: 3, Step is malformed");
});
