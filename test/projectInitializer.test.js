const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const test = require("node:test");

function createFakeVscode(overrides = {}) {
  const commands = [];
  const errors = [];
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
      showErrorMessage(message) {
        errors.push(message);
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
    },
  };
  return {
    commands,
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
