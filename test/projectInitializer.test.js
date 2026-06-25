const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const test = require("node:test");

function createFakeVscode(overrides = {}) {
  const commands = [];
  const errors = [];
  const errorActions = [];
  const inputs = [];
  const progressReports = [];
  const quickPicks = [];
  const openDialogs = [];
  const registered = [];
  const vscode = {
    Uri: {
      file(filename) {
        return { fsPath: filename };
      },
    },
    commands: {
      executeCommand(command, ...args) {
        commands.push({ command, args });
        return Promise.resolve(undefined);
      },
      registerCommand(command, handler) {
        registered.push({ command, handler });
        return { dispose() {} };
      },
    },
    window: {
      showErrorMessage(message, ...actions) {
        errors.push(message);
        errorActions.push(actions);
        return Promise.resolve(undefined);
      },
      showInputBox(options) {
        inputs.push(options);
        return Promise.resolve(overrides.projectName || "shop");
      },
      showOpenDialog(options) {
        openDialogs.push(options);
        return Promise.resolve([{ fsPath: "/workspace" }]);
      },
      showQuickPick(items) {
        quickPicks.push(items);
        return Promise.resolve(items[0]);
      },
      withProgress(options, task) {
        progressReports.push({ options });
        return task({
          report(message) {
            progressReports.push(message);
          },
        });
      },
    },
    workspace: {
      workspaceFolders: overrides.workspaceFolders || [{ uri: { fsPath: "/workspace" } }],
      getConfiguration(section) {
        return {
          get(key) {
            if (section === "gauge.kotlin" && key === "template") {
              return overrides.kotlinTemplate;
            }
            return undefined;
          },
        };
      },
    },
  };
  return {
    commands,
    errorActions,
    errors,
    inputs,
    openDialogs,
    progressReports,
    quickPicks,
    registered,
    vscode,
  };
}

function createChildProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  return child;
}

test("ProjectInitializer creates a Gauge project from the selected template", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");
  const {
    commands,
    inputs,
    openDialogs,
    progressReports,
    quickPicks,
    registered,
    vscode,
  } = createFakeVscode();
  const mkdirs = [];
  const spawns = [];
  const child = createChildProcess();
  const cli = {
    isGaugeInstalled() {
      return true;
    },
    gaugeCommand() {
      return {
        spawn(args, options) {
          spawns.push({ args, options });
          setImmediate(() => child.emit("close", 0));
          return child;
        },
        spawnSync(args) {
          assert.deepEqual(args, ["template", "--list", "--machine-readable"]);
          return {
            stdout: Buffer.from(JSON.stringify([
              { key: "kotlin", Description: "Kotlin", value: "kotlin" },
            ])),
          };
        },
      };
    },
  };

  new ProjectInitializer({
    cli,
    env: { PATH: "/bin" },
    fileSystem: {
      existsSync(filename) {
        assert.equal(filename, "/workspace/shop");
        return false;
      },
      mkdirSync(filename) {
        mkdirs.push(filename);
      },
      removeSync() {},
    },
    pathModule: path.posix,
    vscode,
  });

  const command = registered.find((entry) => entry.command === "gauge.createProject");
  await command.handler();

  assert.deepEqual(quickPicks[0], [
    { label: "kotlin", description: "Kotlin", value: "kotlin" },
  ]);
  assert.deepEqual(openDialogs[0], {
    canSelectFolders: true,
    openLabel: "Select a folder to create the project in",
    canSelectMany: false,
  });
  assert.deepEqual(inputs[0], {
    prompt: "Enter a name for your new project",
    placeHolder: "gauge-tests",
  });
  assert.deepEqual(mkdirs, ["/workspace/shop"]);
  assert.deepEqual(progressReports[1], { message: "Initializing project..." });
  assert.deepEqual(spawns, [
    {
      args: ["init", "kotlin"],
      options: { cwd: "/workspace/shop", env: { PATH: "/bin" } },
    },
  ]);
  assert.deepEqual(commands, [
    {
      command: "vscode.openFolder",
      args: [{ fsPath: "/workspace/shop" }, true],
    },
  ]);
});

test("ProjectInitializer reports official install guidance when Gauge is unavailable", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");
  const {
    errorActions,
    errors,
    inputs,
    openDialogs,
    quickPicks,
    registered,
    vscode,
  } = createFakeVscode();
  const cli = {
    isGaugeInstalled() {
      return false;
    },
  };

  new ProjectInitializer({
    cli,
    fileSystem: {
      existsSync() {
        return false;
      },
      mkdirSync() {},
      removeSync() {},
    },
    pathModule: path.posix,
    vscode,
  });

  const command = registered.find((entry) => entry.command === "gauge.createProject");
  await command.handler();

  assert.deepEqual(errors, [
    "Please install gauge to create a new Gauge project.For more info please refer the [install intructions](https://docs.gauge.org/getting_started/installing-gauge.html).",
  ]);
  assert.deepEqual(errorActions, [[]]);
  assert.deepEqual(quickPicks, []);
  assert.deepEqual(openDialogs, []);
  assert.deepEqual(inputs, []);
});

test("ProjectInitializer removes the project directory when Gauge init fails", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");
  const {
    errors,
    registered,
    vscode,
  } = createFakeVscode();
  const mkdirs = [];
  const removes = [];
  const child = createChildProcess();
  const cli = {
    isGaugeInstalled() {
      return true;
    },
    gaugeCommand() {
      return {
        spawn() {
          setImmediate(() => child.emit("close", 1));
          return child;
        },
        spawnSync() {
          return {
            stdout: Buffer.from(JSON.stringify([
              { key: "kotlin", Description: "Kotlin", value: "kotlin" },
            ])),
          };
        },
      };
    },
  };

  new ProjectInitializer({
    cli,
    env: { PATH: "/bin" },
    fileSystem: {
      existsSync(filename) {
        assert.equal(filename, "/workspace/shop");
        return false;
      },
      mkdirSync(filename) {
        mkdirs.push(filename);
      },
      removeSync(filename) {
        removes.push(filename);
      },
    },
    pathModule: path.posix,
    vscode,
  });

  const command = registered.find((entry) => entry.command === "gauge.createProject");
  await assert.rejects(
    () => command.handler(),
    /Failed to initialize project\./,
  );

  assert.deepEqual(mkdirs, ["/workspace/shop"]);
  assert.deepEqual(removes, ["/workspace/shop"]);
  assert.deepEqual(errors, ["Failed to initialize project."]);
});

test("ProjectInitializer does not open the project directory after Gauge init spawn errors", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");
  const {
    commands,
    errors,
    registered,
    vscode,
  } = createFakeVscode();
  const removes = [];
  const child = createChildProcess();
  const cli = {
    isGaugeInstalled() {
      return true;
    },
    gaugeCommand() {
      return {
        spawn() {
          setImmediate(() => {
            child.emit("error", new Error("spawn failed"));
            child.emit("close", 0);
          });
          return child;
        },
        spawnSync() {
          return {
            stdout: Buffer.from(JSON.stringify([
              { key: "kotlin", Description: "Kotlin", value: "kotlin" },
            ])),
          };
        },
      };
    },
  };

  new ProjectInitializer({
    cli,
    fileSystem: {
      existsSync() {
        return false;
      },
      mkdirSync() {},
      removeSync(filename) {
        removes.push(filename);
      },
    },
    pathModule: path.posix,
    vscode,
  });

  const command = registered.find((entry) => entry.command === "gauge.createProject");
  await assert.rejects(
    () => command.handler(),
    /Failed to create template\. spawn failed/,
  );

  assert.deepEqual(removes, ["/workspace/shop"]);
  assert.deepEqual(errors, ["Failed to create template. spawn failed"]);
  assert.deepEqual(commands, []);
});

test("ProjectInitializer prefers the configured Kotlin project template", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");
  const {
    quickPicks,
    registered,
    vscode,
  } = createFakeVscode({ kotlinTemplate: "gradle" });
  const spawns = [];
  const child = createChildProcess();
  const cli = {
    isGaugeInstalled() {
      return true;
    },
    gaugeCommand() {
      return {
        spawn(args) {
          spawns.push(args);
          setImmediate(() => child.emit("close", 0));
          return child;
        },
        spawnSync() {
          return {
            stdout: Buffer.from(JSON.stringify([
              { key: "java", Description: "Java", value: "java" },
              { key: "kotlin_maven", Description: "Kotlin Maven", value: "kotlin_maven" },
              { key: "kotlin_gradle", Description: "Kotlin Gradle", value: "kotlin_gradle" },
            ])),
          };
        },
      };
    },
  };

  new ProjectInitializer({
    cli,
    fileSystem: {
      existsSync() {
        return false;
      },
      mkdirSync() {},
      removeSync() {},
    },
    pathModule: path.posix,
    vscode,
  });

  const command = registered.find((entry) => entry.command === "gauge.createProject");
  await command.handler();

  assert.equal(quickPicks[0][0].label, "kotlin_gradle");
  assert.deepEqual(spawns, [["init", "kotlin_gradle"]]);
});

test("ProjectInitializer reports template list parsing failures", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");
  const {
    errorActions,
    errors,
    inputs,
    openDialogs,
    quickPicks,
    registered,
    vscode,
  } = createFakeVscode();
  const cli = {
    isGaugeInstalled() {
      return true;
    },
    gaugeCommand() {
      return {
        spawnSync(args) {
          assert.deepEqual(args, ["template", "--list", "--machine-readable"]);
          return {
            stdout: Buffer.from("not-json"),
          };
        },
      };
    },
  };

  new ProjectInitializer({
    cli,
    fileSystem: {
      existsSync() {
        return false;
      },
      mkdirSync() {},
      removeSync() {},
    },
    pathModule: path.posix,
    vscode,
  });

  const command = registered.find((entry) => entry.command === "gauge.createProject");
  await command.handler();

  assert.deepEqual(errors, ["Failed to get list of templates."]);
  assert.deepEqual(errorActions, [[
    " Try running 'gauge template --list ----machine-readable' from command line",
  ]]);
  assert.deepEqual(quickPicks, [[]]);
  assert.deepEqual(openDialogs, []);
  assert.deepEqual(inputs, []);
});
