const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

function createDocument(text, fsPath = "/workspace/gauge/specs/example.spec", languageId = "gauge") {
  const lines = text.split("\n");
  return {
    languageId,
    uri: { fsPath },
    fileName: fsPath,
    getText() {
      return text;
    },
    lineAt(line) {
      return { text: lines[line] || "" };
    },
    get lineCount() {
      return lines.length;
    },
    save() {
      return Promise.resolve(true);
    },
  };
}

function createFakeVscode(options = {}) {
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
    TextEdit: {
      replace(range, newText) {
        return { newText, range };
      },
    },
    window: {
      showErrorMessage(message) {
        if (options.errors) {
          options.errors.push(message);
          return undefined;
        }
        throw new Error(message);
      },
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

test("GaugeFormatProvider returns full document edits from gauge format output", async () => {
  const { GaugeFormatProvider } = require("../src/formatProvider");

  const spawned = [];
  const cli = {
    gaugeCommand() {
      return {
        spawn(args, options) {
          spawned.push({ args, options });
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          process.nextTick(() => child.emit("exit", 0));
          return child;
        },
      };
    },
  };
  const provider = new GaugeFormatProvider({
    cli,
    fileSystem: {
      readFileSync(filename) {
        assert.equal(filename, "/workspace/gauge/specs/example.spec");
        return Buffer.from("# Example\n\n* formatted\n");
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

  const edits = await provider.provideDocumentFormattingEdits(createDocument([
    "# Example",
    "* unformatted",
    "",
  ].join("\n")));

  assert.deepEqual(spawned, [
    {
      args: ["format", "/workspace/gauge/specs/example.spec"],
      options: { cwd: "/workspace/gauge" },
    },
  ]);
  assert.deepEqual(edits.map((edit) => ({
    newText: edit.newText,
    range: {
      start: { ...edit.range.start },
      end: { ...edit.range.end },
    },
  })), [
    {
      newText: "# Example\n\n* formatted\n",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 2, character: 0 },
      },
    },
  ]);
});

test("GaugeFormatProvider formats Markdown language Gauge specs inside Gauge projects", async () => {
  const { GaugeFormatProvider } = require("../src/formatProvider");

  const spawned = [];
  const cli = {
    gaugeCommand() {
      return {
        spawn(args, options) {
          spawned.push({ args, options });
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          process.nextTick(() => child.emit("exit", 0));
          return child;
        },
      };
    },
  };
  const provider = new GaugeFormatProvider({
    cli,
    fileSystem: {
      readFileSync(filename) {
        assert.equal(filename, "/workspace/gauge/specs/example.md");
        return Buffer.from("# Example\n\n* formatted\n");
      },
    },
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/gauge/specs/example.md");
        return "/workspace/gauge";
      },
    },
    vscode: createFakeVscode(),
  });

  const edits = await provider.provideDocumentFormattingEdits(createDocument(
    [
      "# Example",
      "* unformatted",
      "",
    ].join("\n"),
    "/workspace/gauge/specs/example.md",
    "markdown",
  ));

  assert.deepEqual(spawned, [
    {
      args: ["format", "/workspace/gauge/specs/example.md"],
      options: { cwd: "/workspace/gauge" },
    },
  ]);
  assert.deepEqual(edits.map((edit) => edit.newText), [
    "# Example\n\n* formatted\n",
  ]);
});

test("GaugeFormatProvider ignores Markdown files outside Gauge projects", async () => {
  const { GaugeFormatProvider } = require("../src/formatProvider");

  const errors = [];
  const spawned = [];
  const provider = new GaugeFormatProvider({
    cli: {
      gaugeCommand() {
        return {
          spawn(args, options) {
            spawned.push({ args, options });
            throw new Error("should not spawn");
          },
        };
      },
    },
    projectFactory: {
      getGaugeRootFromFilePath() {
        throw new Error("No Gauge project");
      },
    },
    vscode: createFakeVscode({ errors }),
  });

  const edits = await provider.provideDocumentFormattingEdits(createDocument(
    "# Notes\n",
    "/workspace/readme.md",
    "markdown",
  ));

  assert.deepEqual(edits, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(spawned, []);
});

test("GaugeFormatProvider passes configured Gauge home and project environment", async () => {
  const { GaugeFormatProvider } = require("../src/formatProvider");

  const spawned = [];
  const cli = {
    gaugeCommand() {
      return {
        spawn(args, options) {
          spawned.push({ args, options });
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          process.nextTick(() => child.emit("exit", 0));
          return child;
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
      return { GAUGE_CUSTOM_CLASSPATH: "/workspace/gauge/build/classes" };
    },
  };
  const provider = new GaugeFormatProvider({
    cli,
    env: { PATH: "/bin" },
    fileSystem: {
      readFileSync(filename) {
        assert.equal(filename, "/workspace/gauge/specs/example.spec");
        return Buffer.from("# Example\n");
      },
    },
    projectFactory: {
      getProjectByFilepath(filename) {
        assert.equal(filename, "/workspace/gauge/specs/example.spec");
        return project;
      },
    },
    vscode: createFakeVscode({ gaugeHome: "/custom/gauge-home" }),
  });

  const edits = await provider.provideDocumentFormattingEdits(createDocument("# Example\n"));

  assert.deepEqual(edits, []);
  assert.deepEqual(spawned, [
    {
      args: ["format", "/workspace/gauge/specs/example.spec"],
      options: {
        cwd: "/workspace/gauge",
        env: {
          PATH: "/bin",
          GAUGE_HOME: "/custom/gauge-home",
          GAUGE_CUSTOM_CLASSPATH: "/workspace/gauge/build/classes",
        },
      },
    },
  ]);
});

test("GaugeFormatProvider removes deprecated Gauge lines from format failures", async () => {
  const { GaugeFormatProvider } = require("../src/formatProvider");

  const errors = [];
  const cli = {
    gaugeCommand() {
      return {
        spawn() {
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          process.nextTick(() => {
            child.stderr.emit("data", "[DEPRECATED] old behavior\nreal error\n");
            child.emit("exit", 1);
          });
          return child;
        },
      };
    },
  };
  const provider = new GaugeFormatProvider({
    cli,
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/gauge/specs/example.spec");
        return "/workspace/gauge";
      },
    },
    vscode: createFakeVscode({ errors }),
  });

  const edits = await provider.provideDocumentFormattingEdits(createDocument("# Example\n"));

  assert.deepEqual(edits, []);
  assert.deepEqual(errors, ["Error on formatting spec. real error"]);
});

test("GaugeFormatProvider ignores non-Gauge documents", async () => {
  const { GaugeFormatProvider } = require("../src/formatProvider");
  const provider = new GaugeFormatProvider({ vscode: createFakeVscode() });

  const edits = await provider.provideDocumentFormattingEdits(
    createDocument("fun main() {}", "/workspace/gauge/src/test/kotlin/Steps.kt", "kotlin"),
  );

  assert.deepEqual(edits, []);
});
