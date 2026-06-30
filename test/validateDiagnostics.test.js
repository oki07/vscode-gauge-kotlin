const assert = require("node:assert/strict");
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
