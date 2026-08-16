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
  const errorPrompts = [];
  const information = [];
  const informationPrompts = [];
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
        showInformationMessage(message, ...actions) {
          information.push(message);
          informationPrompts.push({ message, actions });
          return Promise.resolve(overrides.informationSelection);
        },
        showErrorMessage(message, ...actions) {
          errors.push(message);
          errorPrompts.push({ message, actions });
          return Promise.resolve(overrides.errorSelection);
        },
      },
    },
    errorPrompts,
    information,
    informationPrompts,
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

test("previewGaugeDocument passes project environment to Spectacle", async () => {
  const { previewGaugeDocument } = require("../src/preview");
  const { opened, vscode } = createFakeVscode();
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
  const project = {
    envs(receivedCli) {
      assert.equal(receivedCli, cli);
      return {
        gauge_custom_classpath: "/workspace/gauge/build/classes",
      };
    },
    root() {
      return "/workspace/gauge";
    },
  };

  await previewGaugeDocument({
    cli,
    env: { PATH: "/bin" },
    fileSystem: {
      mkdirSync() {},
    },
    pathModule: path.posix,
    projectFactory: {
      get(root) {
        assert.equal(root, "/workspace/gauge");
        return project;
      },
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

  assert.deepEqual(spawns, [
    {
      args: ["docs", "spectacle", "/workspace/gauge/specs/example.spec"],
      options: {
        cwd: "/workspace/gauge",
        env: {
          PATH: "/bin",
          gauge_custom_classpath: "/workspace/gauge/build/classes",
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

test("previewGaugeDocument creates Spectacle docs for a Markdown Gauge spec", async () => {
  const { previewGaugeDocument } = require("../src/preview");
  const { errors, opened, vscode } = createFakeVscode({
    document: {
      languageId: "markdown",
      uri: { fsPath: "/workspace/gauge/specs/example.md" },
      fileName: "/workspace/gauge/specs/example.md",
    },
  });
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
    env: { PATH: "/bin" },
    fileSystem: { mkdirSync() {} },
    pathModule: path.posix,
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/gauge/specs/example.md");
        return "/workspace/gauge";
      },
    },
    tempDirProvider() {
      return "/tmp/gauge-preview";
    },
    vscode,
  });

  assert.deepEqual(errors, []);
  assert.deepEqual(spawns, [
    {
      args: ["docs", "spectacle", "/workspace/gauge/specs/example.md"],
      options: {
        cwd: "/workspace/gauge",
        env: {
          PATH: "/bin",
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

test("previewGaugeDocument creates Spectacle docs for concept files by extension", async () => {
  const { previewGaugeDocument } = require("../src/preview");
  const { errors, opened, vscode } = createFakeVscode({
    document: {
      languageId: "plaintext",
      uri: { fsPath: "/workspace/gauge/specs/concepts.cpt" },
      fileName: "/workspace/gauge/specs/concepts.cpt",
    },
  });
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
    env: { PATH: "/bin" },
    fileSystem: { mkdirSync() {} },
    pathModule: path.posix,
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/gauge/specs/concepts.cpt");
        return "/workspace/gauge";
      },
    },
    tempDirProvider() {
      return "/tmp/gauge-preview";
    },
    vscode,
  });

  assert.deepEqual(errors, []);
  assert.deepEqual(spawns, [
    {
      args: ["docs", "spectacle", "/workspace/gauge/specs/concepts.cpt"],
      options: {
        cwd: "/workspace/gauge",
        env: {
          PATH: "/bin",
          spectacle_out_dir: "/tmp/gauge-preview/docs",
        },
      },
    },
  ]);
  assert.deepEqual(opened, [
    {
      fsPath: "/tmp/gauge-preview/docs/html/specs/concepts.html",
      scheme: "file",
    },
  ]);
});

test("previewGaugeDocument creates Spectacle docs for gauge-concept documents by language id", async () => {
  const { previewGaugeDocument } = require("../src/preview");
  const { errors, opened, vscode } = createFakeVscode({
    document: {
      languageId: "gauge-concept",
      uri: { fsPath: "/workspace/gauge/specs/concepts" },
      fileName: "/workspace/gauge/specs/concepts",
    },
  });
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
    env: { PATH: "/bin" },
    fileSystem: { mkdirSync() {} },
    pathModule: path.posix,
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/gauge/specs/concepts");
        return "/workspace/gauge";
      },
    },
    tempDirProvider() {
      return "/tmp/gauge-preview";
    },
    vscode,
  });

  assert.deepEqual(errors, []);
  assert.deepEqual(spawns, [
    {
      args: ["docs", "spectacle", "/workspace/gauge/specs/concepts"],
      options: {
        cwd: "/workspace/gauge",
        env: {
          PATH: "/bin",
          spectacle_out_dir: "/tmp/gauge-preview/docs",
        },
      },
    },
  ]);
  assert.deepEqual(opened, [
    {
      fsPath: "/tmp/gauge-preview/docs/html/specs/concepts.html",
      scheme: "file",
    },
  ]);
});

test("previewGaugeDocument ignores Markdown when the resolved root is not a Gauge project", async () => {
  const {
    NO_ACTIVE_GAUGE_DOCUMENT_MESSAGE,
    previewGaugeDocument,
  } = require("../src/preview");
  const { errors, opened, vscode } = createFakeVscode({
    document: {
      languageId: "markdown",
      uri: { fsPath: "/workspace/notes/example.md" },
      fileName: "/workspace/notes/example.md",
    },
  });
  const madeDirectories = [];
  const spawns = [];
  const cli = {
    gaugeCommand() {
      return {
        spawn(args, options) {
          spawns.push({ args, options });
          throw new Error("should not spawn");
        },
      };
    },
  };

  await previewGaugeDocument({
    cli,
    fileSystem: {
      mkdirSync(directory, options) {
        madeDirectories.push({ directory, options });
      },
    },
    pathModule: path.posix,
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
    tempDirProvider() {
      return "/tmp/gauge-preview";
    },
    vscode,
  });

  assert.deepEqual(errors, [NO_ACTIVE_GAUGE_DOCUMENT_MESSAGE]);
  assert.deepEqual(opened, []);
  assert.deepEqual(madeDirectories, []);
  assert.deepEqual(spawns, []);
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

test("previewGaugeDocument removes deprecated Gauge lines from Spectacle failures", async () => {
  const { previewGaugeDocument } = require("../src/preview");
  const { errors, opened, vscode } = createFakeVscode();
  const cli = {
    gaugeCommand() {
      return {
        spawn() {
          return createChildProcess({
            code: 1,
            stderr: "[DEPRECATED] old behavior\nspectacle failed\n",
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
    "Unable to create html file for example.spec. spectacle failed",
  ]);
});

test("previewGaugeDocument falls back to formatted Gauge HTML when Spectacle is missing", async () => {
  const { previewGaugeDocument } = require("../src/preview");
  const {
    errorPrompts,
    errors,
    informationPrompts,
    opened,
    vscode,
  } = createFakeVscode({
    document: {
      languageId: "gauge",
      uri: { fsPath: "/workspace/gauge/specs/example.spec" },
      fileName: "/workspace/gauge/specs/example.spec",
      getText() {
        return "# Checkout <item>\n\n|name|\n  |alice|\n";
      },
    },
  });
  const madeDirectories = [];
  const installs = [];
  const spawns = [];
  const writes = [];
  const cli = {
    isPluginInstalled(pluginName) {
      assert.equal(pluginName, "spectacle");
      return false;
    },
    installGaugeRunner(pluginName) {
      installs.push(pluginName);
      return Promise.resolve(undefined);
    },
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
    fileSystem: {
      mkdirSync(directory, options) {
        madeDirectories.push({ directory, options });
      },
      writeFileSync(filename, content, options) {
        writes.push({ filename, content, options });
      },
    },
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

  assert.deepEqual(informationPrompts, []);
  assert.deepEqual(errorPrompts, [
    {
      message: "Missing plugin: Spectacle. To install, run `gauge install spectacle` or click below.",
      actions: ["Install Spectacle"],
    },
  ]);
  assert.deepEqual(installs, []);
  assert.deepEqual(spawns, []);
  assert.deepEqual(madeDirectories, [
    { directory: "/tmp/gauge-preview", options: { recursive: true } },
    { directory: "/tmp/gauge-preview/docs", options: { recursive: true } },
    {
      directory: "/tmp/gauge-preview/docs/html/specs",
      options: { recursive: true },
    },
  ]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].filename, "/tmp/gauge-preview/docs/html/specs/example.html");
  assert.equal(writes[0].options, "utf8");
  assert.match(writes[0].content, /# Checkout &lt;item&gt;/);
  assert.match(writes[0].content, /\n\t\|alice\|/);
  assert.deepEqual(opened, [
    {
      fsPath: "/tmp/gauge-preview/docs/html/specs/example.html",
      scheme: "file",
    },
  ]);
});

test("previewGaugeDocument formats fallback table blocks like IntelliJ preview", async () => {
  const { previewGaugeDocument } = require("../src/preview");
  const source = [
    "Steps Collection",
    "================",
    "",
    "tags: api",
    "",
    "* In an empty directory initialize a project with the <current> language",
    "* Create a specification \"Specification 1\" with the following contexts",
    "    |step text|implementation         |",
    "    |---------|-----------------------|",
    "    |context 1|\"inside first context\" |",
    "    |context 2|\"inside second context\"|",
    "* Create a specification \"Specification 1\" with the following contexts",
    "        |step text|implementation         |",
    "    |---------|-----------------------|",
    "       |context 1|\"inside first context\" |",
    "* Create a specification \"Specification 1\" with the following contexts",
    "",
    "",
    "    |step text|implementation         |",
    "    |---------|-----------------------|",
    "    |context 1|\"inside first context\" |",
    "",
  ].join("\n");
  const expectedBody = [
    "Steps Collection",
    "================",
    "",
    "tags: api",
    "",
    "* In an empty directory initialize a project with the &lt;current&gt; language",
    "* Create a specification \"Specification 1\" with the following contexts",
    "",
    "\t|step text|implementation         |",
    "\t|---------|-----------------------|",
    "\t|context 1|\"inside first context\" |",
    "\t|context 2|\"inside second context\"|",
    "* Create a specification \"Specification 1\" with the following contexts",
    "",
    "\t|step text|implementation         |",
    "\t|---------|-----------------------|",
    "\t|context 1|\"inside first context\" |",
    "* Create a specification \"Specification 1\" with the following contexts",
    "",
    "\t|step text|implementation         |",
    "\t|---------|-----------------------|",
    "\t|context 1|\"inside first context\" |",
    "",
  ].join("\n");
  const { vscode } = createFakeVscode({
    document: {
      languageId: "gauge",
      uri: { fsPath: "/workspace/gauge/specs/example.spec" },
      fileName: "/workspace/gauge/specs/example.spec",
      getText() {
        return source;
      },
    },
  });
  const writes = [];
  const cli = {
    isPluginInstalled() {
      return false;
    },
  };

  await previewGaugeDocument({
    cli,
    fileSystem: {
      mkdirSync() {},
      writeFileSync(filename, content) {
        writes.push({ filename, content });
      },
    },
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

  assert.equal(writes.length, 1);
  const body = writes[0].content.match(/<pre>([\s\S]*)<\/pre>/)[1];
  assert.equal(body, expectedBody);
});

test("previewGaugeDocument installs Spectacle when the missing plugin action is selected", async () => {
  const { previewGaugeDocument } = require("../src/preview");
  const { errorPrompts, informationPrompts, opened, vscode } = createFakeVscode({
    document: {
      languageId: "gauge",
      uri: { fsPath: "/workspace/gauge/specs/example.spec" },
      fileName: "/workspace/gauge/specs/example.spec",
      getText() {
        return "# Checkout\n";
      },
    },
    errorSelection: "Install Spectacle",
  });
  const installs = [];
  const writes = [];
  const cli = {
    isPluginInstalled(pluginName) {
      assert.equal(pluginName, "spectacle");
      return false;
    },
    installGaugeRunner(pluginName) {
      installs.push(pluginName);
      return Promise.resolve("installed");
    },
  };

  await previewGaugeDocument({
    cli,
    fileSystem: {
      mkdirSync() {},
      writeFileSync(filename, content, options) {
        writes.push({ filename, content, options });
      },
    },
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

  assert.deepEqual(informationPrompts, []);
  assert.deepEqual(errorPrompts, [
    {
      message: "Missing plugin: Spectacle. To install, run `gauge install spectacle` or click below.",
      actions: ["Install Spectacle"],
    },
  ]);
  assert.deepEqual(installs, ["spectacle"]);
  assert.equal(writes.length, 1);
  assert.deepEqual(opened, [
    {
      fsPath: "/tmp/gauge-preview/docs/html/specs/example.html",
      scheme: "file",
    },
  ]);
});

test("previewGaugeDocument does not start duplicate Spectacle installs", async () => {
  const { previewGaugeDocument } = require("../src/preview");
  const { information, vscode } = createFakeVscode({
    document: {
      languageId: "gauge",
      uri: { fsPath: "/workspace/gauge/specs/example.spec" },
      fileName: "/workspace/gauge/specs/example.spec",
      getText() {
        return "# Checkout\n";
      },
    },
    errorSelection: "Install Spectacle",
  });
  let finishInstall;
  let assertionError;
  const installPromise = new Promise((resolve) => {
    finishInstall = resolve;
  });
  const installs = [];
  const cli = {
    isPluginInstalled(pluginName) {
      assert.equal(pluginName, "spectacle");
      return false;
    },
    installGaugeRunner(pluginName) {
      installs.push(pluginName);
      return installPromise;
    },
  };
  const options = {
    cli,
    fileSystem: {
      mkdirSync() {},
      writeFileSync() {},
    },
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
  };

  const firstPreview = previewGaugeDocument(options);
  await Promise.resolve();
  const secondPreview = previewGaugeDocument(options);
  await Promise.resolve();

  try {
    assert.deepEqual(installs, ["spectacle"]);
    assert.equal(information.includes("Installation in progress..."), true);
  } catch (error) {
    assertionError = error;
  }
  finishInstall("installed");
  await Promise.all([firstPreview, secondPreview]);
  if (assertionError) {
    throw assertionError;
  }
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
