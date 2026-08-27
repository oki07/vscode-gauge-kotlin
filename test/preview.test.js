const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const test = require("node:test");

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function createDeferredChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killCalls = 0;
  child.kill = () => {
    child.killCalls += 1;
    return true;
  };
  return child;
}

function createChildProcess(options = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  setImmediate(() => {
    const code = options.code || 0;
    if (options.stdout) {
      child.stdout.emit("data", Buffer.from(options.stdout));
    }
    if (options.stderr) {
      child.stderr.emit("data", Buffer.from(options.stderr));
    }
    child.emit("exit", code);
    child.emit("close", code);
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

test("previewGaugeDocument does not create output when Spectacle is missing", async () => {
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
  let tempDirectoryCalls = 0;
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
      tempDirectoryCalls += 1;
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
  assert.equal(tempDirectoryCalls, 0);
  assert.deepEqual(madeDirectories, []);
  assert.deepEqual(writes, []);
  assert.deepEqual(opened, []);
});

test("previewGaugeDocument installs Spectacle without creating output for the current request", async () => {
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

  const outcome = await previewGaugeDocument({
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
  assert.equal(outcome, undefined);
  assert.deepEqual(writes, []);
  assert.deepEqual(opened, []);
});

test("previewGaugeDocument does not create output when Spectacle installation fails", async () => {
  const { previewGaugeDocument } = require("../src/preview");
  const { errors, opened, vscode } = createFakeVscode({
    errorSelection: "Install Spectacle",
  });
  const installs = [];
  const writes = [];

  const outcome = await previewGaugeDocument({
    cli: {
      isPluginInstalled() {
        return false;
      },
      installGaugeRunner(pluginName) {
        installs.push(pluginName);
        return Promise.resolve(false);
      },
    },
    fileSystem: {
      mkdirSync() {
        throw new Error("directories should not be created");
      },
      writeFileSync(filename) {
        writes.push(filename);
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

  assert.equal(outcome, undefined);
  assert.deepEqual(installs, ["spectacle"]);
  assert.deepEqual(writes, []);
  assert.deepEqual(opened, []);
  assert.equal(errors.length, 1);
});

test("previewGaugeDocument uses the post-install version manifest on the next preview", async () => {
  const { CLI } = require("../src/cli");
  const { GaugePreviewController } = require("../src/preview");
  const installChild = createDeferredChild();
  const docsChild = createDeferredChild();
  const installEntered = deferred();
  const spawns = [];
  const command = {
    spawn(args, options) {
      spawns.push({ args, options });
      if (args[0] === "install") {
        if (spawns.filter((entry) => entry.args[0] === "install").length === 1) {
          installEntered.resolve();
          return installChild;
        }
        const repeatedInstallChild = createDeferredChild();
        setImmediate(() => {
          repeatedInstallChild.emit("exit", 0);
          repeatedInstallChild.emit("close", 0);
        });
        return repeatedInstallChild;
      }
      setImmediate(() => {
        docsChild.emit("exit", 0);
        docsChild.emit("close", 0);
      });
      return docsChild;
    },
    spawnSync(args) {
      assert.deepEqual(args, ["--version", "--machine-readable"]);
      return {
        status: 0,
        stdout: Buffer.from(JSON.stringify({
          version: "1.2.3",
          plugins: [{ name: "Spectacle", version: "1.0.0" }],
        })),
      };
    },
  };
  const cli = new CLI(command, { version: "1.2.3", plugins: [] });
  const {
    errorPrompts,
    opened,
    vscode,
  } = createFakeVscode({
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
  vscode.window.createOutputChannel = () => ({ appendLine() {}, clear() {}, show() {} });
  const installGaugeRunner = cli.installGaugeRunner.bind(cli);
  cli.installGaugeRunner = (name) => installGaugeRunner(name, {
    env: { PATH: "/bin" },
    vscode,
  });
  const writes = [];
  const controller = new GaugePreviewController({
    cli,
    env: { PATH: "/bin" },
    fileSystem: {
      mkdirSync() {},
      writeFileSync(filename) {
        writes.push(filename);
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

  const firstPreview = controller.preview();
  await installEntered.promise;
  installChild.emit("exit", 0);
  installChild.emit("close", 0);
  assert.equal(await firstPreview, undefined);

  const secondPreview = controller.preview();
  assert.equal(await secondPreview, true);

  assert.deepEqual(spawns.map((entry) => entry.args), [
    ["install", "spectacle"],
    ["docs", "spectacle", "/workspace/gauge/specs/example.spec"],
  ]);
  assert.equal(errorPrompts.length, 1);
  assert.equal(writes.length, 0);
  assert.equal(opened.length, 1);
});

test("GaugePreviewController does not block an install follower on the progress notification", async () => {
  const { GaugePreviewController } = require("../src/preview");
  const { errorPrompts, information, opened, vscode } = createFakeVscode({
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
  const informationEntered = deferred();
  const informationResponse = deferred();
  const originalShowInformationMessage = vscode.window.showInformationMessage;
  vscode.window.showInformationMessage = (...args) => {
    originalShowInformationMessage(...args);
    informationEntered.resolve();
    return informationResponse.promise;
  };
  const installEntered = deferred();
  let finishInstall;
  let assertionError;
  const installPromise = new Promise((resolve) => {
    finishInstall = resolve;
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
      installEntered.resolve();
      return installPromise;
    },
  };
  const controller = new GaugePreviewController({
    cli,
    fileSystem: {
      mkdirSync() {},
      writeFileSync(filename) {
        writes.push(filename);
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

  const firstPreview = controller.preview();
  await installEntered.promise;
  const secondPreview = controller.preview();
  let secondOutcome = { status: "pending" };
  secondPreview.then(
    (value) => {
      secondOutcome = { status: "fulfilled", value };
    },
    (error) => {
      secondOutcome = { error, status: "rejected" };
    },
  );
  await informationEntered.promise;
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(secondOutcome, { status: "pending" });
    assert.equal(controller.activeOperations.size, 2);
    assert.deepEqual(writes, []);
    assert.deepEqual(opened, []);

    finishInstall("installed");
    await firstPreview;
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(installs, ["spectacle"]);
    assert.equal(information.includes("Installation in progress..."), true);
    assert.deepEqual(secondOutcome, { status: "fulfilled", value: undefined });
    assert.equal(controller.activeOperations.size, 0);
    assert.equal(errorPrompts.length, 2);
    assert.deepEqual(writes, []);
    assert.deepEqual(opened, []);
  } catch (error) {
    assertionError = error;
  } finally {
    finishInstall("installed");
    informationResponse.reject(new Error("notification closed"));
    await Promise.allSettled([firstPreview, secondPreview]);
    await new Promise((resolve) => setImmediate(resolve));
  }
  try {
    assert.equal(errorPrompts.length, 2);
  } catch (error) {
    if (!assertionError) {
      assertionError = error;
    }
  }
  if (assertionError) {
    throw assertionError;
  }
});

test("GaugePreviewController follows a shared install when the progress notification throws", async () => {
  const { GaugePreviewController } = require("../src/preview");
  const installEntered = deferred();
  const installResponse = deferred();
  const notificationEntered = deferred();
  const { errorPrompts, opened, vscode } = createFakeVscode({
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
  vscode.window.showInformationMessage = () => {
    notificationEntered.resolve();
    throw new Error("notification failed");
  };
  const installs = [];
  const writes = [];
  const controller = new GaugePreviewController({
    cli: {
      isPluginInstalled() {
        return false;
      },
      installGaugeRunner(pluginName) {
        installs.push(pluginName);
        installEntered.resolve();
        return installResponse.promise;
      },
    },
    fileSystem: {
      mkdirSync() {},
      writeFileSync(filename) {
        writes.push(filename);
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

  const firstPreview = controller.preview();
  await installEntered.promise;
  const secondPreview = controller.preview();
  await notificationEntered.promise;
  installResponse.resolve("installed");

  assert.equal(await firstPreview, undefined);
  assert.equal(await secondPreview, undefined);
  assert.deepEqual(installs, ["spectacle"]);
  assert.equal(errorPrompts.length, 2);
  assert.deepEqual(writes, []);
  assert.deepEqual(opened, []);
  assert.equal(controller.activeOperations.size, 0);
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

test("GaugePreviewController lifecycle detaches active docs without killing them", async () => {
  const { GaugePreviewController } = require("../src/preview");
  const { errors, opened, vscode } = createFakeVscode();
  const child = createDeferredChild();
  const spawns = [];
  const controller = new GaugePreviewController({
    cli: {
      isPluginInstalled() {
        return true;
      },
      gaugeCommand() {
        return {
          spawn(args, options) {
            spawns.push({ args, options });
            return child;
          },
        };
      },
    },
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

  const active = controller.preview();
  assert.equal(spawns.length, 1);
  assert.equal(controller.activeOperations.size, 1);

  child.emit("exit", 0);
  controller.dispose();
  controller.dispose();

  assert.equal(await active, undefined);
  assert.equal(controller.activeOperations.size, 0);
  assert.equal(child.killCalls, 0);
  assert.equal(child.listenerCount("error") > 0, true);
  assert.doesNotThrow(() => child.emit("error", new Error("late docs failure")));
  child.emit("close", 1);
  assert.equal(child.listenerCount("error"), 0);
  assert.equal(child.listenerCount("exit"), 0);
  assert.equal(child.listenerCount("close"), 0);
  assert.equal(child.stdout.listenerCount("data"), 0);
  assert.equal(child.stderr.listenerCount("data"), 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(opened, []);

  assert.equal(await controller.preview(), undefined);
  assert.equal(spawns.length, 1);
});

test("GaugePreviewController lifecycle neutralizes pending environment settlements", async () => {
  const { GaugePreviewController } = require("../src/preview");

  for (const settlement of ["resolve", "reject"]) {
    const environmentEntered = deferred();
    const environmentResponse = deferred();
    const { errors, opened, vscode } = createFakeVscode();
    const spawns = [];
    const controller = new GaugePreviewController({
      cli: {
        isPluginInstalled() {
          return true;
        },
        gaugeCommand() {
          return {
            spawn() {
              spawns.push(settlement);
              return createDeferredChild();
            },
          };
        },
      },
      fileSystem: { mkdirSync() {} },
      pathModule: path.posix,
      projectEnvironmentService: {
        environmentFor() {
          environmentEntered.resolve();
          return environmentResponse.promise;
        },
      },
      projectFactory: {
        getProjectByFilepath() {
          return { root: "/workspace/gauge" };
        },
      },
      tempDirProvider() {
        return "/tmp/gauge-preview";
      },
      vscode,
    });

    const pending = controller.preview();
    await environmentEntered.promise;
    controller.dispose();
    assert.equal(await pending, undefined);

    if (settlement === "resolve") {
      environmentResponse.resolve({ gauge_custom_classpath: "/workspace/classes" });
    } else {
      environmentResponse.reject(new Error("late environment failure"));
    }
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(spawns, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(opened, []);
  }
});

test("GaugePreviewController lifecycle separates prompt and install ownership", async () => {
  const { GaugePreviewController } = require("../src/preview");

  for (const boundary of ["prompt", "install"]) {
    for (const settlement of ["resolve", "reject"]) {
      const promptResponse = deferred();
      const installEntered = deferred();
      const installResponse = deferred();
      const { errors, opened, vscode } = createFakeVscode();
      const installs = [];
      const writes = [];
      vscode.window.showErrorMessage = (message) => {
        errors.push(message);
        return boundary === "prompt"
          ? promptResponse.promise
          : Promise.resolve("Install Spectacle");
      };
      const controller = new GaugePreviewController({
        cli: {
          isPluginInstalled() {
            return false;
          },
          installGaugeRunner(pluginName) {
            installs.push(pluginName);
            installEntered.resolve();
            return installResponse.promise;
          },
        },
        fileSystem: {
          mkdirSync() {},
          writeFileSync(filename) {
            writes.push(filename);
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

      const pending = controller.preview();
      if (boundary === "install") {
        await installEntered.promise;
      }
      controller.dispose();
      assert.equal(await pending, undefined);

      const response = boundary === "prompt" ? promptResponse : installResponse;
      if (settlement === "resolve") {
        response.resolve("Install Spectacle");
      } else {
        response.reject(new Error(`late ${boundary} failure`));
      }
      await new Promise((resolve) => setImmediate(resolve));

      assert.deepEqual(installs, boundary === "install" ? ["spectacle"] : []);
      assert.deepEqual(writes, []);
      assert.deepEqual(opened, []);
      assert.equal(errors.length, 1);
    }
  }
});

test("GaugePreviewController lifecycle guards spawn reentrancy", async () => {
  const { GaugePreviewController } = require("../src/preview");
  const { errors, opened, vscode } = createFakeVscode();
  const child = createDeferredChild();
  let controller;
  controller = new GaugePreviewController({
    cli: {
      isPluginInstalled() {
        return true;
      },
      gaugeCommand() {
        return {
          spawn() {
            controller.dispose();
            return child;
          },
        };
      },
    },
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

  assert.equal(await controller.preview(), undefined);
  assert.equal(child.killCalls, 0);
  assert.doesNotThrow(() => child.emit("error", new Error("late spawn failure")));
  child.emit("close", 1);
  assert.equal(child.listenerCount("error"), 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(opened, []);
});

test("GaugePreviewController lifecycle guards synchronous preparation reentrancy", async () => {
  const { GaugePreviewController } = require("../src/preview");
  const boundaries = [
    "activeDocument",
    "project",
    "cli",
    "tempDirectory",
    "pluginCheck",
    "command",
  ];

  for (const boundary of boundaries) {
    const { errors, opened, vscode } = createFakeVscode();
    const calls = [];
    let controller;
    const stopAt = (value) => {
      calls.push(value);
      if (value === boundary) {
        controller.dispose();
      }
    };
    if (boundary === "activeDocument") {
      const document = vscode.window.activeTextEditor.document;
      Object.defineProperty(vscode.window, "activeTextEditor", {
        get() {
          stopAt("activeDocument");
          return { document };
        },
      });
    }
    controller = new GaugePreviewController({
      createCli() {
        stopAt("cli");
        return {
          isPluginInstalled() {
            stopAt("pluginCheck");
            return true;
          },
          gaugeCommand() {
            stopAt("command");
            return {
              spawn() {
                calls.push("spawn");
                return createDeferredChild();
              },
            };
          },
        };
      },
      fileSystem: { mkdirSync() {} },
      pathModule: path.posix,
      projectFactory: {
        getGaugeRootFromFilePath() {
          stopAt("project");
          return "/workspace/gauge";
        },
      },
      tempDirProvider() {
        stopAt("tempDirectory");
        return "/tmp/gauge-preview";
      },
      vscode,
    });

    assert.equal(await controller.preview(), undefined);
    assert.equal(calls.includes(boundary), true);
    assert.equal(calls.includes("spawn"), false);
    assert.deepEqual(errors, []);
    assert.deepEqual(opened, []);
  }
});

test("GaugePreviewController lifecycle neutralizes pending browser settlements", async () => {
  const { GaugePreviewController } = require("../src/preview");

  for (const settlement of ["resolve", "reject"]) {
    const { errors, opened, vscode } = createFakeVscode();
    const child = createDeferredChild();
    const openEntered = deferred();
    const openResponse = deferred();
    vscode.env.openExternal = (uri) => {
      opened.push(uri);
      openEntered.resolve();
      return openResponse.promise;
    };
    const controller = new GaugePreviewController({
      cli: {
        isPluginInstalled() {
          return true;
        },
        gaugeCommand() {
          return { spawn() { return child; } };
        },
      },
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

    const pending = controller.preview();
    child.emit("close", 0);
    await openEntered.promise;
    controller.dispose();
    assert.equal(await pending, undefined);

    if (settlement === "resolve") {
      openResponse.resolve(true);
    } else {
      openResponse.reject(new Error("late browser failure"));
    }
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(opened.length, 1);
    assert.deepEqual(errors, []);
    assert.equal(controller.activeOperations.size, 0);
  }
});

test("GaugePreviewController lifecycle observes promises returned during synchronous disposal", async () => {
  const { GaugePreviewController } = require("../src/preview");
  const { errors, opened, vscode } = createFakeVscode();
  let observedRejections = 0;
  let controller;
  const rejectedThenable = {
    then(_resolve, reject) {
      observedRejections += 1;
      reject(new Error("synchronous disposal environment failure"));
    },
  };
  controller = new GaugePreviewController({
    cli: {
      isPluginInstalled() {
        return true;
      },
      gaugeCommand() {
        return { spawn() { return createDeferredChild(); } };
      },
    },
    fileSystem: { mkdirSync() {} },
    pathModule: path.posix,
    projectEnvironmentService: {
      environmentFor() {
        controller.dispose();
        return rejectedThenable;
      },
    },
    projectFactory: {
      getProjectByFilepath() {
        return { root: "/workspace/gauge" };
      },
    },
    tempDirProvider() {
      return "/tmp/gauge-preview";
    },
    vscode,
  });

  assert.equal(await controller.preview(), undefined);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(observedRejections, 1);
  assert.deepEqual(errors, []);
  assert.deepEqual(opened, []);
});

test("GaugePreviewController preserves live environment failures", async () => {
  const { GaugePreviewController } = require("../src/preview");
  const { errors, opened, vscode } = createFakeVscode();
  const environmentError = new Error("live preview environment failure");
  const spawns = [];
  const controller = new GaugePreviewController({
    cli: {
      isPluginInstalled() {
        return true;
      },
      gaugeCommand() {
        return {
          spawn() {
            spawns.push("spawn");
            return createDeferredChild();
          },
        };
      },
    },
    fileSystem: { mkdirSync() {} },
    pathModule: path.posix,
    projectEnvironmentService: {
      environmentFor() {
        return Promise.reject(environmentError);
      },
    },
    projectFactory: {
      getProjectByFilepath() {
        return { root: "/workspace/gauge" };
      },
    },
    tempDirProvider() {
      return "/tmp/gauge-preview";
    },
    vscode,
  });

  await assert.rejects(
    controller.preview(),
    (error) => error === environmentError,
  );
  assert.deepEqual(spawns, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(opened, []);
  assert.equal(controller.activeOperations.size, 0);
});

test("GaugePreviewController waits for close before publishing Spectacle success or failure", async () => {
  const { GaugePreviewController } = require("../src/preview");

  for (const scenario of [
    { closeCode: undefined, code: 0, result: true, terminal: "success" },
    { closeCode: 1, code: 1, result: undefined, terminal: "failure" },
    {
      closeCode: 0,
      code: 1,
      error: new Error("live docs failure"),
      result: undefined,
      terminal: "error",
    },
  ]) {
    const { errors, opened, vscode } = createFakeVscode();
    const child = createDeferredChild();
    const controller = new GaugePreviewController({
      cli: {
        isPluginInstalled() {
          return true;
        },
        gaugeCommand() {
          return { spawn() { return child; } };
        },
      },
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

    const pending = controller.preview();
    let outcome = { status: "pending" };
    pending.then(
      (value) => {
        outcome = { status: "fulfilled", value };
      },
      (error) => {
        outcome = { error, status: "rejected" };
      },
    );
    if (scenario.terminal === "failure") {
      child.stderr.emit("data", "missing ");
    }
    if (scenario.terminal === "error") {
      child.emit("error", scenario.error);
    } else {
      child.emit("exit", scenario.code);
    }

    let assertionError;
    try {
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(outcome, { status: "pending" });
      assert.equal(controller.activeOperations.size, 1);
      assert.deepEqual(errors, []);
      assert.deepEqual(opened, []);
      assert.equal(child.stdout.listenerCount("data"), 1);
      assert.equal(child.stderr.listenerCount("data"), 1);
    } catch (error) {
      assertionError = error;
    } finally {
      if (scenario.terminal === "success") {
        child.stdout.emit("data", "created\n");
      } else if (scenario.terminal === "failure") {
        child.stderr.emit("data", "spectacle plugin");
      }
      child.emit("close", scenario.closeCode);
      await Promise.allSettled([pending]);
    }

    try {
      assert.deepEqual(outcome, { status: "fulfilled", value: scenario.result });
      assert.equal(controller.activeOperations.size, 0);
      assert.equal(child.listenerCount("error"), 0);
      assert.equal(child.listenerCount("exit"), 0);
      assert.equal(child.listenerCount("close"), 0);
      assert.equal(child.stdout.listenerCount("data"), 0);
      assert.equal(child.stderr.listenerCount("data"), 0);
      assert.equal(child.killCalls, 0);
      if (scenario.terminal === "success") {
        assert.deepEqual(errors, []);
        assert.equal(opened.length, 1);
      } else {
        const reason = scenario.terminal === "failure"
          ? "missing spectacle plugin"
          : "live docs failure";
        assert.deepEqual(errors, [
          `Unable to create html file for example.spec. ${reason}`,
        ]);
        assert.deepEqual(opened, []);
      }
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

test("GaugePreviewController releases live process listeners after close", async () => {
  const { GaugePreviewController } = require("../src/preview");

  for (const terminal of ["error", "exit"]) {
    const { errors, opened, vscode } = createFakeVscode();
    const child = createDeferredChild();
    const controller = new GaugePreviewController({
      cli: {
        isPluginInstalled() {
          return true;
        },
        gaugeCommand() {
          return { spawn() { return child; } };
        },
      },
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

    const pending = controller.preview();
    if (terminal === "error") {
      child.emit("error", new Error("live docs failure"));
    } else {
      child.emit("exit", 0);
    }
    assert.equal(child.listenerCount("close"), 1);
    child.emit("close", terminal === "error" ? 1 : 0);
    await pending;

    assert.equal(child.listenerCount("error"), 0);
    assert.equal(child.listenerCount("exit"), 0);
    assert.equal(child.listenerCount("close"), 0);
    assert.equal(child.stdout.listenerCount("data"), 0);
    assert.equal(child.stderr.listenerCount("data"), 0);
    assert.equal(errors.length, terminal === "error" ? 1 : 0);
    assert.equal(opened.length, terminal === "exit" ? 1 : 0);
  }
});

test("GaugePreviewController preserves independent live preview requests", async () => {
  const { GaugePreviewController } = require("../src/preview");
  const { opened, vscode } = createFakeVscode();
  const children = [];
  const controller = new GaugePreviewController({
    cli: {
      isPluginInstalled() {
        return true;
      },
      gaugeCommand() {
        return {
          spawn() {
            const child = createDeferredChild();
            children.push(child);
            return child;
          },
        };
      },
    },
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

  const first = controller.preview();
  const second = controller.preview();
  assert.notStrictEqual(first, second);
  assert.equal(children.length, 2);
  assert.equal(controller.activeOperations.size, 2);

  children[1].emit("close", 0);
  children[0].emit("close", 0);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(opened.length, 2);
  assert.equal(controller.activeOperations.size, 0);
  assert.deepEqual(children.map((child) => child.killCalls), [0, 0]);
  assert.deepEqual(children.map((child) => child.listenerCount("error")), [0, 0]);
  assert.deepEqual(children.map((child) => child.listenerCount("close")), [0, 0]);
});

// Spectacle can exit zero and still not produce the file the extension computed:
// the plugin decides its own output layout, and spectacle_out_dir only names the
// root. Opening a path that is not there does nothing at all and says nothing.
test("previewGaugeDocument reports an HTML file Spectacle did not produce", async () => {
  const { previewGaugeDocument } = require("../src/preview");
  const { errors, opened, vscode } = createFakeVscode();
  const cli = {
    gaugeCommand() {
      return {
        spawn() {
          return createChildProcess({ stdout: "created\n" });
        },
      };
    },
  };

  await previewGaugeDocument({
    cli,
    env: { PATH: "/bin" },
    fileSystem: {
      existsSync() {
        return false;
      },
      mkdirSync() {},
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

  assert.deepEqual(opened, []);
  assert.deepEqual(errors, [
    "Unable to preview example.spec. Spectacle did not produce"
    + " /tmp/gauge-preview/docs/html/specs/example.html.",
  ]);
});
