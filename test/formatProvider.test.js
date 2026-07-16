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
            if (key === "home") {
              return options.gaugeHome;
            }
            if (key === "formatting.skipEmptyLineInsertions") {
              return Boolean(options.skipEmptyLineInsertions);
            }
            return "";
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

test("GaugeFormatProvider formats concept files by extension", async () => {
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
        assert.equal(filename, "/workspace/gauge/specs/concepts.cpt");
        return Buffer.from("# Login flow\n\n* formatted\n");
      },
    },
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/gauge/specs/concepts.cpt");
        return "/workspace/gauge";
      },
    },
    vscode: createFakeVscode(),
  });

  const edits = await provider.provideDocumentFormattingEdits(createDocument(
    [
      "# Login flow",
      "* unformatted",
      "",
    ].join("\n"),
    "/workspace/gauge/specs/concepts.cpt",
    "plaintext",
  ));

  assert.deepEqual(spawned, [
    {
      args: ["format", "/workspace/gauge/specs/concepts.cpt"],
      options: { cwd: "/workspace/gauge" },
    },
  ]);
  assert.deepEqual(edits.map((edit) => edit.newText), [
    "# Login flow\n\n* formatted\n",
  ]);
});

test("GaugeFormatProvider formats gauge-concept documents by language id", async () => {
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
        assert.equal(filename, "/workspace/gauge/specs/concepts");
        return Buffer.from("# Login flow\n\n* formatted\n");
      },
    },
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/gauge/specs/concepts");
        return "/workspace/gauge";
      },
    },
    vscode: createFakeVscode(),
  });

  const edits = await provider.provideDocumentFormattingEdits(createDocument(
    [
      "# Login flow",
      "* unformatted",
      "",
    ].join("\n"),
    "/workspace/gauge/specs/concepts",
    "gauge-concept",
  ));

  assert.deepEqual(spawned, [
    {
      args: ["format", "/workspace/gauge/specs/concepts"],
      options: { cwd: "/workspace/gauge" },
    },
  ]);
  assert.deepEqual(edits.map((edit) => edit.newText), [
    "# Login flow\n\n* formatted\n",
  ]);
});

test("GaugeFormatProvider formats spec files by extension", async () => {
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
        assert.equal(filename, "/workspace/gauge/specs/plain.spec");
        return Buffer.from("# Example\n\n* formatted\n");
      },
    },
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/gauge/specs/plain.spec");
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
    "/workspace/gauge/specs/plain.spec",
    "plaintext",
  ));

  assert.deepEqual(spawned, [
    {
      args: ["format", "/workspace/gauge/specs/plain.spec"],
      options: { cwd: "/workspace/gauge" },
    },
  ]);
  assert.deepEqual(edits.map((edit) => edit.newText), [
    "# Example\n\n* formatted\n",
  ]);
});

test("GaugeFormatProvider passes skip empty line insertion option to gauge format", async () => {
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
        return Buffer.from("# Example\n");
      },
    },
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/gauge/specs/example.spec");
        return "/workspace/gauge";
      },
    },
    vscode: createFakeVscode({ skipEmptyLineInsertions: true }),
  });

  const edits = await provider.provideDocumentFormattingEdits(createDocument("# Example\n"));

  assert.deepEqual(edits, []);
  assert.deepEqual(spawned, [
    {
      args: ["format", "--skip-empty-line-insertions", "/workspace/gauge/specs/example.spec"],
      options: { cwd: "/workspace/gauge" },
    },
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

test("GaugeFormatProvider ignores Markdown when the resolved root is not a Gauge project", async () => {
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
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/notes/example.md");
        return "/workspace/notes";
      },
      isGaugeProject(root) {
        assert.equal(root, "/workspace/notes");
        return false;
      },
    },
    vscode: createFakeVscode({ errors }),
  });

  const edits = await provider.provideDocumentFormattingEdits(createDocument(
    "# Notes\n",
    "/workspace/notes/example.md",
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

test("GaugeFormatProvider caches the project environment across format requests", async () => {
  const { GaugeFormatProvider } = require("../src/formatProvider");
  let envCalls = 0;
  const project = {
    envs() {
      envCalls += 1;
      return { gauge_custom_classpath: "/classes" };
    },
    root() {
      return "/workspace/gauge";
    },
  };
  const command = {
    spawn() {
      const { EventEmitter } = require("node:events");
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      process.nextTick(() => child.emit("close", 0));
      return child;
    },
  };
  const documentText = "# Example\n";
  const provider = new GaugeFormatProvider({
    cli: {
      gaugeCommand() {
        return command;
      },
    },
    env: { PATH: "/bin" },
    fileSystem: {
      readFileSync() {
        return Buffer.from(documentText);
      },
    },
    projectFactory: {
      getProjectByFilepath() {
        return project;
      },
      isGaugeProject() {
        return true;
      },
    },
    vscode: createFakeVscode(),
  });
  const document = {
    languageId: "gauge",
    uri: { fsPath: "/workspace/gauge/specs/example.spec" },
    getText() {
      return documentText;
    },
  };

  await provider.provideDocumentFormattingEdits(document);
  await provider.provideDocumentFormattingEdits(document);

  assert.equal(envCalls, 1);
});
