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

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createCancellation() {
  const listeners = new Set();
  let listenerDisposals = 0;
  let registrations = 0;
  let requested = false;
  const token = {
    get isCancellationRequested() {
      return requested;
    },
    onCancellationRequested(listener) {
      registrations += 1;
      listeners.add(listener);
      return {
        dispose() {
          if (listeners.delete(listener)) {
            listenerDisposals += 1;
          }
        },
      };
    },
  };
  return {
    cancel() {
      if (requested) {
        return;
      }
      requested = true;
      for (const listener of [...listeners]) {
        listener();
      }
    },
    listenerDisposals() {
      return listenerDisposals;
    },
    listenerCount() {
      return listeners.size;
    },
    registrations() {
      return registrations;
    },
    token,
  };
}

// The formatter shells out to "gauge format", which rewrites the file on disk,
// and then replaces the whole document with what it reads back. If the user
// types while the CLI is running, that replacement discards the new text. VS
// Code protects its own formatting API by version, but gauge.format applies the
// edits directly (src/extension.js formatActiveGaugeDocument), so the provider
// has to check (vscode.d.ts TextDocument.version).
test("GaugeFormatProvider drops its edit when the document changed during formatting", async () => {
  const { GaugeFormatProvider } = require("../src/formatProvider");
  const document = createDocument([
    "# Checkout",
    "* Pay",
  ].join("\n"), "/workspace/gauge/specs/checkout.spec", "gauge");
  document.version = 1;
  document.save = () => Promise.resolve(true);

  const provider = new GaugeFormatProvider({
    cli: {
      gaugeCommand: () => ({
        spawn() {
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          process.nextTick(() => {
            child.emit("exit", 0);
            child.emit("close", 0);
          });
          return child;
        },
      }),
    },
    fileSystem: {
      readFileSync() {
        // gauge format has finished; the user typed while it ran.
        document.version = 2;
        return Buffer.from("# Checkout\n\n* Pay\n");
      },
    },
    projectFactory: {
      getGaugeRootFromFilePath: () => "/workspace/gauge",
    },
    vscode: createFakeVscode(),
  });

  const edits = await provider.provideDocumentFormattingEdits(document);

  assert.equal(document.version, 2, "the format path must have run");
  assert.deepEqual(edits, []);
});

// vscode.d.ts declares TextDocument.save(): Thenable<boolean>. A false result
// leaves the document's in-memory text unsaved, while gauge format rewrites the
// file on disk. Formatting that stale file and returning it as a whole-document
// edit would overwrite the user's unsaved text.
test("GaugeFormatProvider does not format when saving the document fails", async () => {
  const { GaugeFormatProvider } = require("../src/formatProvider");
  const spawned = [];
  const document = createDocument("# Checkout\n* Pay\n");
  document.isDirty = true;
  document.save = () => Promise.resolve(false);
  const provider = new GaugeFormatProvider({
    cli: {
      gaugeCommand: () => ({
        spawn(...args) {
          spawned.push(args);
          throw new Error("format must not start after a failed save");
        },
      }),
    },
    fileSystem: {
      readFileSync() {
        throw new Error("format output must not be read after a failed save");
      },
    },
    projectFactory: {
      getGaugeRootFromFilePath: () => "/workspace/gauge",
    },
    vscode: createFakeVscode(),
  });

  const edits = await provider.provideDocumentFormattingEdits(document);

  assert.deepEqual(edits, []);
  assert.deepEqual(spawned, []);
});

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
          process.nextTick(() => {
            child.emit("exit", 0);
            child.emit("close", 0);
          });
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

  assert.equal(provider.activeRequests.size, 0);
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
          process.nextTick(() => {
            child.emit("exit", 0);
            child.emit("close", 0);
          });
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
          process.nextTick(() => {
            child.emit("exit", 0);
            child.emit("close", 0);
          });
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
          process.nextTick(() => {
            child.emit("exit", 0);
            child.emit("close", 0);
          });
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
          process.nextTick(() => {
            child.emit("exit", 0);
            child.emit("close", 0);
          });
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
          process.nextTick(() => {
            child.emit("exit", 0);
            child.emit("close", 0);
          });
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
          process.nextTick(() => {
            child.emit("exit", 0);
            child.emit("close", 0);
          });
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
            child.emit("close", 1);
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

test("GaugeFormatProvider waits for close before publishing live format results", async () => {
  const { GaugeFormatProvider } = require("../src/formatProvider");

  for (const scenario of [
    {
      closeCode: undefined,
      exitCode: 0,
      formatted: "# Example\n\n* formatted\n",
      resultCount: 1,
      terminal: "success",
    },
    {
      closeCode: 1,
      exitCode: 1,
      expectedError: "Error on formatting spec. missing implementation",
      resultCount: 0,
      terminal: "failure",
    },
    {
      closeCode: 0,
      expectedError: "Error on formatting spec. live format failure",
      processError: new Error("live format failure"),
      resultCount: 0,
      terminal: "error",
    },
  ]) {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killCalls = 0;
    child.kill = () => {
      child.killCalls += 1;
    };
    const errors = [];
    const spawned = deferred();
    let readCalls = 0;
    const provider = new GaugeFormatProvider({
      cli: {
        gaugeCommand() {
          return {
            spawn() {
              spawned.resolve();
              return child;
            },
          };
        },
      },
      fileSystem: {
        readFileSync() {
          readCalls += 1;
          return Buffer.from(scenario.formatted || "# Example\n");
        },
      },
      projectFactory: {
        getGaugeRootFromFilePath() {
          return "/workspace/gauge";
        },
      },
      vscode: createFakeVscode({ errors }),
    });

    const pending = provider.provideDocumentFormattingEdits(
      createDocument("# Example\n* unformatted\n"),
    );
    let outcome = { status: "pending" };
    pending.then(
      (value) => {
        outcome = { status: "fulfilled", value };
      },
      (error) => {
        outcome = { error, status: "rejected" };
      },
    );
    await spawned.promise;
    if (scenario.terminal === "failure") {
      child.stderr.emit("data", "missing ");
    }
    if (scenario.terminal === "error") {
      child.emit("error", scenario.processError);
    } else {
      child.emit("exit", scenario.exitCode);
    }

    let assertionError;
    try {
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(outcome, { status: "pending" });
      assert.equal(provider.activeRequests.size, 1);
      assert.equal(readCalls, 0);
      assert.deepEqual(errors, []);
      assert.equal(child.stdout.listenerCount("data"), 1);
      assert.equal(child.stderr.listenerCount("data"), 1);
    } catch (error) {
      assertionError = error;
    } finally {
      if (scenario.terminal === "failure") {
        child.stderr.emit("data", "implementation");
      }
      child.emit("close", scenario.closeCode);
      await Promise.allSettled([pending]);
    }

    try {
      assert.equal(outcome.status, "fulfilled");
      assert.equal(outcome.value.length, scenario.resultCount);
      assert.equal(provider.activeRequests.size, 0);
      assert.equal(readCalls, scenario.terminal === "success" ? 1 : 0);
      assert.deepEqual(errors, scenario.expectedError ? [scenario.expectedError] : []);
      assert.equal(child.listenerCount("error"), 0);
      assert.equal(child.listenerCount("exit"), 0);
      assert.equal(child.listenerCount("close"), 0);
      assert.equal(child.stdout.listenerCount("data"), 0);
      assert.equal(child.stderr.listenerCount("data"), 0);
      assert.equal(child.killCalls, 0);
    } catch (error) {
      if (!assertionError) {
        assertionError = error;
      }
    }
    if (assertionError) {
      throw assertionError;
    }
  }
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

test("GaugeFormatProvider cancellation skips formatting before work starts", async () => {
  const { GaugeFormatProvider } = require("../src/formatProvider");
  const errors = [];
  let saveCalls = 0;
  let spawnCalls = 0;
  const document = createDocument("# Example\n");
  document.save = () => {
    saveCalls += 1;
    return Promise.resolve(true);
  };
  const provider = new GaugeFormatProvider({
    cli: {
      gaugeCommand() {
        return {
          spawn() {
            spawnCalls += 1;
            throw new Error("should not spawn");
          },
        };
      },
    },
    projectFactory: {
      getGaugeRootFromFilePath() {
        return "/workspace/gauge";
      },
    },
    vscode: createFakeVscode({ errors }),
  });
  const token = {
    isCancellationRequested: true,
    onCancellationRequested() {
      throw new Error("pre-cancelled formatting must not subscribe");
    },
  };

  const edits = await provider.provideDocumentFormattingEdits(document, {}, token);

  assert.deepEqual({ edits, errors, saveCalls, spawnCalls }, {
    edits: [],
    errors: [],
    saveCalls: 0,
    spawnCalls: 0,
  });
});

test("GaugeFormatProvider cancellation stops after pending preparation", async () => {
  const { GaugeFormatProvider } = require("../src/formatProvider");

  for (const boundaryName of ["save", "environment"]) {
    for (const outcome of ["resolve", "reject"]) {
      const boundary = deferred();
      const cancellation = createCancellation();
      const entered = deferred();
      const errors = [];
      let spawnCalls = 0;
      const document = createDocument("# Example\n");
      if (boundaryName === "save") {
        document.save = () => {
          entered.resolve();
          return boundary.promise;
        };
      }
      const provider = new GaugeFormatProvider({
        cli: {
          gaugeCommand() {
            return {
              spawn() {
                spawnCalls += 1;
                throw new Error("should not spawn");
              },
            };
          },
        },
        projectEnvironmentService: {
          environmentFor() {
            if (boundaryName === "environment") {
              entered.resolve();
              return boundary.promise;
            }
            throw new Error("environment lookup should not start");
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
          isGaugeProject() {
            return true;
          },
        },
        vscode: createFakeVscode({ errors }),
      });
      const pending = provider.provideDocumentFormattingEdits(
        document,
        {},
        cancellation.token,
      );

      await entered.promise;
      cancellation.cancel();
      if (outcome === "resolve") {
        boundary.resolve(boundaryName === "save" ? true : {});
      } else {
        boundary.resolve(Promise.reject(new Error(`${boundaryName} failed`)));
      }
      const edits = await pending;

      assert.deepEqual({
        boundaryName,
        edits,
        errors,
        outcome,
        spawnCalls,
      }, {
        boundaryName,
        edits: [],
        errors: [],
        outcome,
        spawnCalls: 0,
      });
    }
  }
});

test("GaugeFormatProvider cancellation kills active formats and ignores late settlements", async () => {
  const { GaugeFormatProvider } = require("../src/formatProvider");

  for (const lateSettlement of ["close", "error"]) {
    const cancellation = createCancellation();
    const child = new EventEmitter();
    const errors = [];
    const spawned = deferred();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killCalls = 0;
    child.kill = () => {
      child.killCalls += 1;
      return true;
    };
    let readCalls = 0;
    const provider = new GaugeFormatProvider({
      cli: {
        gaugeCommand() {
          return {
            spawn() {
              spawned.resolve();
              return child;
            },
          };
        },
      },
      fileSystem: {
        readFileSync() {
          readCalls += 1;
          return Buffer.from("# Formatted\n");
        },
      },
      projectFactory: {
        getGaugeRootFromFilePath() {
          return "/workspace/gauge";
        },
      },
      vscode: createFakeVscode({ errors }),
    });
    let settled = false;
    const pending = provider
      .provideDocumentFormattingEdits(
        createDocument("# Original\n"),
        {},
        cancellation.token,
      )
      .then((edits) => {
        settled = true;
        return edits;
      });

    await spawned.promise;
    cancellation.cancel();
    await new Promise((resolve) => setImmediate(resolve));

    const settledBeforeLate = settled;
    const listenersAfterCancellation = {
      childClose: child.listenerCount("close"),
      childError: child.listenerCount("error"),
      childExit: child.listenerCount("exit"),
      stderrData: child.stderr.listenerCount("data"),
      stdoutData: child.stdout.listenerCount("data"),
    };
    if (lateSettlement === "close") {
      child.emit("close", 0);
    } else {
      assert.doesNotThrow(() => child.emit("error", new Error("late format error")));
      child.emit("close", 1);
    }
    const edits = await pending;
    const listenersAfterLate = {
      childClose: child.listenerCount("close"),
      childError: child.listenerCount("error"),
      childExit: child.listenerCount("exit"),
      stderrData: child.stderr.listenerCount("data"),
      stdoutData: child.stdout.listenerCount("data"),
    };

    assert.deepEqual({
      edits,
      errors,
      killCalls: child.killCalls,
      lateSettlement,
      listenerDisposals: cancellation.listenerDisposals(),
      listenersAfterCancellation,
      listenersAfterLate,
      readCalls,
      registrations: cancellation.registrations(),
      remainingTokenListeners: cancellation.listenerCount(),
      settledBeforeLate,
    }, {
      edits: [],
      errors: [],
      killCalls: 1,
      lateSettlement,
      listenerDisposals: 1,
      listenersAfterCancellation: {
        childClose: 1,
        childError: 1,
        childExit: 0,
        stderrData: 0,
        stdoutData: 0,
      },
      listenersAfterLate: {
        childClose: 0,
        childError: 0,
        childExit: 0,
        stderrData: 0,
        stdoutData: 0,
      },
      readCalls: 0,
      registrations: 1,
      remainingTokenListeners: 0,
      settledBeforeLate: true,
    });
  }
});

test("GaugeFormatProvider cancellation owns a child returned after synchronous cancellation", async () => {
  const { GaugeFormatProvider } = require("../src/formatProvider");
  const cancellation = createCancellation();
  const child = new EventEmitter();
  const errors = [];
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killCalls = 0;
  child.kill = () => {
    child.killCalls += 1;
    return true;
  };
  const provider = new GaugeFormatProvider({
    cli: {
      gaugeCommand() {
        return {
          spawn() {
            cancellation.cancel();
            return child;
          },
        };
      },
    },
    projectFactory: {
      getGaugeRootFromFilePath() {
        return "/workspace/gauge";
      },
    },
    vscode: createFakeVscode({ errors }),
  });

  const edits = await provider.provideDocumentFormattingEdits(
    createDocument("# Original\n"),
    {},
    cancellation.token,
  );
  const lateError = new Error("late spawn cancellation error");

  assert.doesNotThrow(() => child.emit("error", lateError));
  child.emit("close", 1);
  assert.deepEqual({
    edits,
    errors,
    killCalls: child.killCalls,
    registrations: cancellation.registrations(),
  }, {
    edits: [],
    errors: [],
    killCalls: 1,
    registrations: 0,
  });
});

test("GaugeFormatProvider cancellation handles synchronous token and kill callbacks", async () => {
  const { GaugeFormatProvider } = require("../src/formatProvider");

  for (const killSettlement of ["error", "close"]) {
    const child = new EventEmitter();
    const errors = [];
    let listenerDisposals = 0;
    let requested = false;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killCalls = 0;
    child.kill = () => {
      child.killCalls += 1;
      if (killSettlement === "error") {
        child.emit("error", new Error("synchronous kill error"));
      } else {
        child.emit("close", 1);
      }
      return true;
    };
    const token = {
      get isCancellationRequested() {
        return requested;
      },
      onCancellationRequested(listener) {
        requested = true;
        listener();
        return {
          dispose() {
            listenerDisposals += 1;
          },
        };
      },
    };
    const provider = new GaugeFormatProvider({
      cli: {
        gaugeCommand() {
          return {
            spawn() {
              return child;
            },
          };
        },
      },
      projectFactory: {
        getGaugeRootFromFilePath() {
          return "/workspace/gauge";
        },
      },
      vscode: createFakeVscode({ errors }),
    });

    const edits = await provider.provideDocumentFormattingEdits(
      createDocument("# Original\n"),
      {},
      token,
    );
    if (killSettlement === "error") {
      child.emit("close", 1);
    }

    assert.deepEqual({
      childListeners: {
        close: child.listenerCount("close"),
        error: child.listenerCount("error"),
        exit: child.listenerCount("exit"),
      },
      edits,
      errors,
      killCalls: child.killCalls,
      killSettlement,
      listenerDisposals,
      streamListeners: {
        stderr: child.stderr.listenerCount("data"),
        stdout: child.stdout.listenerCount("data"),
      },
    }, {
      childListeners: { close: 0, error: 0, exit: 0 },
      edits: [],
      errors: [],
      killCalls: 1,
      killSettlement,
      listenerDisposals: 1,
      streamListeners: { stderr: 0, stdout: 0 },
    });
  }
});

test("GaugeFormatProvider disposal neutralizes pending preparation and later work", async () => {
  const { GaugeFormatProvider } = require("../src/formatProvider");

  for (const boundaryName of ["save", "environment"]) {
    for (const outcome of ["resolve", "reject"]) {
      const boundary = deferred();
      const entered = deferred();
      const errors = [];
      let environmentCalls = 0;
      let gaugeCommandCalls = 0;
      let projectCalls = 0;
      let readCalls = 0;
      let saveCalls = 0;
      let spawnCalls = 0;
      const document = createDocument("# Original\n");
      document.save = () => {
        saveCalls += 1;
        if (boundaryName === "save") {
          entered.resolve();
          return boundary.promise;
        }
        return Promise.resolve(true);
      };
      const provider = new GaugeFormatProvider({
        cli: {
          gaugeCommand() {
            gaugeCommandCalls += 1;
            return {
              spawn() {
                spawnCalls += 1;
                throw new Error("should not spawn");
              },
            };
          },
        },
        fileSystem: {
          readFileSync() {
            readCalls += 1;
            return Buffer.from("# Formatted\n");
          },
        },
        projectEnvironmentService: {
          environmentFor() {
            environmentCalls += 1;
            if (boundaryName !== "environment") {
              throw new Error("environment lookup should not start");
            }
            entered.resolve();
            return boundary.promise;
          },
        },
        projectFactory: {
          getProjectByFilepath() {
            projectCalls += 1;
            return {
              root() {
                return "/workspace/gauge";
              },
            };
          },
          isGaugeProject() {
            return true;
          },
        },
        vscode: createFakeVscode({ errors }),
      });
      provider.projectEnvironments.set("/workspace/warm", { WARM: "true" });
      const pending = provider.provideDocumentFormattingEdits(document);

      await entered.promise;
      provider.dispose();
      provider.dispose();
      const activeRequestCountAfterDispose = provider.activeRequests.size;
      const cacheSizeAfterDispose = provider.projectEnvironments.size;
      if (outcome === "resolve") {
        boundary.resolve(boundaryName === "save" ? true : {});
      } else {
        boundary.resolve(Promise.reject(new Error(`${boundaryName} failed`)));
      }
      const [pendingOutcome, laterOutcome] = await Promise.allSettled([
        pending,
        provider.provideDocumentFormattingEdits(document),
      ]);

      assert.deepEqual({
        boundaryName,
        activeRequestCountAfterDispose,
        cacheSizeAfterDispose,
        environmentCalls,
        errors,
        gaugeCommandCalls,
        laterOutcome,
        outcome,
        pendingOutcome,
        projectCalls,
        readCalls,
        saveCalls,
        spawnCalls,
      }, {
        boundaryName,
        activeRequestCountAfterDispose: 0,
        cacheSizeAfterDispose: 0,
        environmentCalls: boundaryName === "environment" ? 1 : 0,
        errors: [],
        gaugeCommandCalls: boundaryName === "environment" ? 1 : 0,
        laterOutcome: { status: "fulfilled", value: [] },
        outcome,
        pendingOutcome: { status: "fulfilled", value: [] },
        projectCalls: 1,
        readCalls: 0,
        saveCalls: 1,
        spawnCalls: 0,
      });
    }
  }
});

test("GaugeFormatProvider disposal cancels concurrent formats during synchronous spawn", async () => {
  const { GaugeFormatProvider } = require("../src/formatProvider");
  const cancellation = createCancellation();
  const errors = [];
  const firstSpawned = deferred();
  const secondSpawned = deferred();
  const children = [new EventEmitter(), new EventEmitter()];
  for (const [index, child] of children.entries()) {
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killCalls = 0;
    child.kill = () => {
      child.killCalls += 1;
      if (index === 0) {
        child.emit("error", new Error("synchronous disposal kill error"));
      }
      child.emit("close", 1);
      return true;
    };
  }
  let provider;
  let readCalls = 0;
  let spawnCalls = 0;
  const command = {
    spawn() {
      const index = spawnCalls;
      spawnCalls += 1;
      const child = children[index];
      if (index === 0) {
        firstSpawned.resolve();
      } else {
        secondSpawned.resolve();
        provider.dispose();
      }
      return child;
    },
  };
  provider = new GaugeFormatProvider({
    cli: {
      gaugeCommand() {
        return command;
      },
    },
    fileSystem: {
      readFileSync() {
        readCalls += 1;
        return Buffer.from("# Formatted\n");
      },
    },
    projectFactory: {
      getGaugeRootFromFilePath() {
        return "/workspace/gauge";
      },
    },
    vscode: createFakeVscode({ errors }),
  });
  const settled = [false, false];
  const pending = [provider.provideDocumentFormattingEdits(
    createDocument("# First\n"),
    {},
    cancellation.token,
  )];
  pending[0] = pending[0].then((value) => {
    settled[0] = true;
    return value;
  });

  await firstSpawned.promise;
  pending.push(provider.provideDocumentFormattingEdits(createDocument("# Second\n")));
  pending[1] = pending[1].then((value) => {
    settled[1] = true;
    return value;
  });
  await secondSpawned.promise;
  const activeRequestCountAfterDispose = provider.activeRequests.size;
  provider.dispose();
  await new Promise((resolve) => setImmediate(resolve));

  const settledBeforeCleanup = [...settled];
  for (const [index, child] of children.entries()) {
    if (!settled[index]) {
      child.emit("close", 1);
    }
  }
  const outcomes = await Promise.allSettled(pending);
  const later = await provider.provideDocumentFormattingEdits(createDocument("# Later\n"));

  assert.deepEqual({
    activeRequestCountAfterDispose,
    childListeners: children.map((child) => ({
      close: child.listenerCount("close"),
      error: child.listenerCount("error"),
      exit: child.listenerCount("exit"),
      stderr: child.stderr.listenerCount("data"),
      stdout: child.stdout.listenerCount("data"),
    })),
    errors,
    hostListenerDisposals: cancellation.listenerDisposals(),
    hostListenerCount: cancellation.listenerCount(),
    hostRegistrations: cancellation.registrations(),
    killCalls: children.map((child) => child.killCalls),
    later,
    outcomes,
    readCalls,
    settledBeforeCleanup,
    spawnCalls,
  }, {
    activeRequestCountAfterDispose: 0,
    childListeners: [
      { close: 0, error: 0, exit: 0, stderr: 0, stdout: 0 },
      { close: 0, error: 0, exit: 0, stderr: 0, stdout: 0 },
    ],
    errors: [],
    hostListenerDisposals: 1,
    hostListenerCount: 0,
    hostRegistrations: 1,
    killCalls: [1, 1],
    later: [],
    outcomes: [
      { status: "fulfilled", value: [] },
      { status: "fulfilled", value: [] },
    ],
    readCalls: 0,
    settledBeforeCleanup: [true, true],
    spawnCalls: 2,
  });
});
