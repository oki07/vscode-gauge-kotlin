const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const test = require("node:test");

function createChildProcess(options = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  setImmediate(() => {
    if (options.stdout) {
      child.stdout.emit("data", Buffer.from(options.stdout));
    }
    if (options.stderr) {
      child.stderr.emit("data", Buffer.from(options.stderr));
    }
    child.emit("exit", options.code || 0);
  });
  return child;
}

function createFakeVscode(overrides = {}) {
  const errors = [];
  const opened = [];
  const document = overrides.document || {
    languageId: "gauge",
    uri: { fsPath: "/workspace/gauge/specs/example.spec" },
    fileName: "/workspace/gauge/specs/example.spec",
  };
  return {
    errors,
    opened,
    vscode: {
      Uri: {
        file(filename) {
          return { fsPath: filename, scheme: "file" };
        },
      },
      env: {
        openExternal(uri) {
          opened.push(uri);
          return Promise.resolve(true);
        },
      },
      window: {
        activeTextEditor: document ? { document } : undefined,
        showErrorMessage(message) {
          errors.push(message);
          return Promise.resolve(undefined);
        },
      },
    },
  };
}

test("previewGaugeDocument creates Spectacle docs for the active Gauge document", async () => {
  const { previewGaugeDocument } = require("../src/preview");
  const { opened, vscode } = createFakeVscode();
  const madeDirectories = [];
  const spawns = [];
  const cli = {
    gaugeCommand() {
      return {
        spawn(args, options) {
          spawns.push({ args, options });
          return createChildProcess({ stdout: "created\n" });
        },
      };
    },
  };

  await previewGaugeDocument({
    cli,
    env: { PATH: "/bin", GAUGE_ENV: "dev" },
    fileSystem: {
      mkdirSync(directory, options) {
        madeDirectories.push({ directory, options });
      },
    },
    pathModule: path.posix,
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/gauge/specs/example.spec");
        return "/workspace/gauge";
      },
    },
    tempDirProvider() {
      return "/tmp/gauge-preview";
    },
    vscode,
  });

  assert.deepEqual(madeDirectories, [
    { directory: "/tmp/gauge-preview", options: { recursive: true } },
    { directory: "/tmp/gauge-preview/docs", options: { recursive: true } },
  ]);
  assert.deepEqual(spawns, [
    {
      args: ["docs", "spectacle", "/workspace/gauge/specs/example.spec"],
      options: {
        cwd: "/workspace/gauge",
        env: {
          PATH: "/bin",
          GAUGE_ENV: "dev",
          spectacle_out_dir: "/tmp/gauge-preview/docs",
        },
      },
    },
  ]);
  assert.deepEqual(opened, [
    {
      fsPath: "/tmp/gauge-preview/docs/html/specs/example.html",
      scheme: "file",
    },
  ]);
});

test("previewGaugeDocument reports Spectacle generation failures", async () => {
  const { previewGaugeDocument } = require("../src/preview");
  const { errors, opened, vscode } = createFakeVscode();
  const cli = {
    gaugeCommand() {
      return {
        spawn() {
          return createChildProcess({
            code: 1,
            stderr: "missing spectacle plugin",
          });
        },
      };
    },
  };

  await previewGaugeDocument({
    cli,
    fileSystem: { mkdirSync() {} },
    pathModule: path.posix,
    projectFactory: {
      getGaugeRootFromFilePath() {
        return "/workspace/gauge";
      },
    },
    tempDirProvider() {
      return "/tmp/gauge-preview";
    },
    vscode,
  });

  assert.deepEqual(opened, []);
  assert.deepEqual(errors, [
    "Unable to create html file for example.spec. missing spectacle plugin",
  ]);
});

test("previewGaugeDocument requires an active Gauge document", async () => {
  const { previewGaugeDocument } = require("../src/preview");
  const { errors, opened, vscode } = createFakeVscode({
    document: {
      languageId: "plaintext",
      uri: { fsPath: "/workspace/readme.md" },
      fileName: "/workspace/readme.md",
    },
  });

  await previewGaugeDocument({ vscode });

  assert.deepEqual(opened, []);
  assert.deepEqual(errors, ["Open a Gauge specification or concept to preview."]);
});
