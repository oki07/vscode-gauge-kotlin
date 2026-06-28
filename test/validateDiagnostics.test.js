const assert = require("node:assert/strict");
const test = require("node:test");

function createFakeVscode() {
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
  };
}

function createDocument(text, fsPath = "/workspace/gauge/specs/example.spec") {
  return {
    languageId: "gauge",
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
