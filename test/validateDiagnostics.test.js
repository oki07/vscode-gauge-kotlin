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

test("GaugeValidateDiagnosticsProvider registers validation refresh listeners", async () => {
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
    vscode: fakeVscode,
  });

  const disposable = provider.register();
  await new Promise((resolve) => setImmediate(resolve));
  await saved[0]();
  closed[0](document);
  await new Promise((resolve) => setImmediate(resolve));
  disposable.dispose();

  assert.equal(opened.length, 1);
  assert.equal(saved.length, 1);
  assert.equal(closed.length, 1);
  assert.equal(spawnCalls.length, 3);
  assert.equal(sets.length, 3);
  assert.deepEqual(
    sets.map((entry) => entry.diagnostics[0].message),
    [
      "ParseError line number: 3, Step is malformed",
      "ParseError line number: 3, Step is malformed",
      "ParseError line number: 3, Step is malformed",
    ],
  );
  assert.deepEqual(deletes, [document.uri]);
  assert.deepEqual(disposals, ["gauge-validate", "open", "save", "close"]);
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
