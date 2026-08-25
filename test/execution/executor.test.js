const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const test = require("node:test");

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((nextResolve, nextReject) => {
    reject = nextReject;
    resolve = nextResolve;
  });
  return { promise, reject, resolve };
}

function installCancellationSources(vscode) {
  const sources = [];
  vscode.CancellationTokenSource = class CancellationTokenSource {
    constructor() {
      this.cancelCalls = 0;
      this.disposeCalls = 0;
      this.token = {
        get isCancellationRequested() {
          return this.source.cancelCalls > 0;
        },
        source: this,
      };
      sources.push(this);
    }

    cancel() {
      this.cancelCalls += 1;
    }

    dispose() {
      this.disposeCalls += 1;
    }
  };
  return sources;
}

function trackDisposableProvider(provider) {
  const state = {
    disposeCalls: 0,
    operation: undefined,
  };
  function trackedProvider(...args) {
    state.operation = provider(...args);
    return state.operation;
  }
  trackedProvider.dispose = () => {
    state.disposeCalls += 1;
    if (provider && typeof provider.dispose === "function") {
      provider.dispose();
    }
  };
  trackedProvider.state = state;
  return trackedProvider;
}

function createFakeVscode(overrides = {}) {
  const commandCalls = [];
  const errors = [];
  const quickPicks = [];
  const statusBarItems = [];
  const workspaceFolders = overrides.workspaceFolders || [
    { uri: { fsPath: "/workspace" } },
  ];
  return {
    commandCalls,
    errors,
    quickPicks,
    statusBarItems,
    vscode: {
      StatusBarAlignment: {
        Left: "left",
      },
      commands: {
        executeCommand(command, ...args) {
          commandCalls.push({ command, args });
          return Promise.resolve(undefined);
        },
      },
      workspace: {
        workspaceFolders,
        saveAll: overrides.saveAll,
        getConfiguration(section) {
          if (section === "gauge") {
            return {
              get() {
                return undefined;
              },
            };
          }
          assert.equal(section, "launch");
          return {
            get(key) {
              assert.equal(key, "configurations");
              return overrides.launchConfigurations || [];
            },
          };
        },
      },
      window: {
        activeTextEditor: overrides.activeTextEditor || {
          document: {
            fileName: "/workspace/specs/example.spec",
            uri: { fsPath: "/workspace/specs/example.spec" },
          },
        },
        async showQuickPick(items, options) {
          quickPicks.push({ items, options });
          if (typeof overrides.showQuickPick === "function") {
            return overrides.showQuickPick(items, options);
          }
          return overrides.quickPickSelection || items[0];
        },
        async showErrorMessage(message) {
          errors.push(message);
          return undefined;
        },
        createStatusBarItem(alignment, priority) {
          const item = {
            alignment,
            command: undefined,
            color: undefined,
            disposeCalls: 0,
            hideCalls: 0,
            priority,
            showCalls: 0,
            text: undefined,
            tooltip: undefined,
            dispose() {
              this.disposeCalls += 1;
            },
            hide() {
              this.hideCalls += 1;
            },
            show() {
              this.showCalls += 1;
            },
          };
          statusBarItems.push(item);
          return item;
        },
      },
    },
  };
}

test("execute specification uses Gradle Gauge args for Kotlin Gradle projects", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const { vscode } = createFakeVscode({
    launchConfigurations: [
      { type: "gauge", request: "test", name: "Gauge", tags: "smoke" },
    ],
  });

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/build.gradle.kts";
      },
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  const result = await controller.handleCommand("gauge.execute.specification");

  assert.equal(result, true);
  assert.deepEqual(calls, [
    {
      command: "gradle",
      args: [
        "clean",
        "gauge",
        "-Ptags=smoke",
        "-PadditionalFlags=--hide-suggestion --simple-console",
        "-PspecsDir=specs/example.spec",
      ],
      cwd: "/workspace",
      status: "/workspace/specs/example.spec",
    },
  ]);
});

test("execute specification saves workspace documents before starting Gauge", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const events = [];
  const { vscode } = createFakeVscode({
    saveAll(includeUntitled) {
      events.push(["saveAll", includeUntitled]);
      return Promise.resolve(true);
    },
  });

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/build.gradle.kts";
      },
    },
    async runner(command) {
      events.push(["runner", command.command]);
      return true;
    },
  });

  await controller.handleCommand("gauge.execute.specification");

  assert.deepEqual(events, [
    ["saveAll", false],
    ["runner", "gradle"],
  ]);
});

test("execute shows the running status before saving workspace documents", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  let finishSave;
  const save = new Promise((resolve) => {
    finishSave = resolve;
  });
  const { statusBarItems, vscode } = createFakeVscode({
    saveAll() {
      return save;
    },
  });
  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    runner() {
      return Promise.resolve(true);
    },
  });

  const execution = controller.handleCommand("gauge.execute.specification.all");
  await Promise.resolve();

  assert.equal(statusBarItems[0].showCalls, 1);

  finishSave(true);
  assert.equal(await execution, true);
});

test("execute specification preserves launch parallel options", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const { vscode } = createFakeVscode({
    launchConfigurations: [
      { type: "gauge", request: "test", name: "Gauge", parallel: true, n: 3 },
    ],
  });

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/build.gradle.kts";
      },
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  await controller.handleCommand("gauge.execute.specification");

  assert.deepEqual(calls[0].args, [
    "clean",
    "gauge",
    "-PinParallel=true",
    "-Pnodes=3",
    "-PadditionalFlags=--hide-suggestion --simple-console",
    "-PspecsDir=specs/example.spec",
  ]);
});

test("execute specification preserves launch failed options", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const { vscode } = createFakeVscode({
    launchConfigurations: [
      { type: "gauge", request: "test", name: "Gauge", failed: true },
    ],
  });

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/manifest.json";
      },
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  await controller.handleCommand("gauge.execute.specification");

  assert.deepEqual(calls[0].args, ["run", "--failed"]);
});

test("execute specification preserves launch repeat options", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const { vscode } = createFakeVscode({
    launchConfigurations: [
      { type: "gauge", request: "test", name: "Gauge", repeat: true },
    ],
  });

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/manifest.json";
      },
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  await controller.handleCommand("gauge.execute.specification");

  assert.deepEqual(calls[0].args, ["run", "--repeat"]);
});

test("execute specification applies launch process options", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const { vscode } = createFakeVscode({
    launchConfigurations: [
      {
        type: "gauge",
        request: "test",
        name: "Gauge",
        args: ["--custom", "value"],
        cwd: "tools/runner",
        processEnv: {
          FEATURE: "enabled",
        },
        tags: "smoke",
      },
    ],
  });

  const controller = createGaugeExecutionController({
    vscode,
    env: { PATH: "/bin" },
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  const result = await controller.handleCommand("gauge.execute.specification");

  assert.equal(result, true);
  assert.deepEqual(calls, [
    {
      command: "gauge",
      args: [
        "run",
        "--hide-suggestion",
        "--simple-console",
        "--tags",
        "smoke",
        "--custom",
        "value",
        "/workspace/specs/example.spec",
      ],
      cwd: "/workspace/tools/runner",
      env: {
        PATH: "/bin",
        FEATURE: "enabled",
      },
      status: "/workspace/specs/example.spec",
    },
  ]);
});

test("execute specification uses the project execution Command object", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const cli = { id: "cli" };
  const executionCommand = {
    command: "./gradlew",
    argsForSpawnType(args) {
      return args;
    },
  };
  let receivedCli;
  const { vscode } = createFakeVscode({
    launchConfigurations: [
      { type: "gauge", request: "test", name: "Gauge", tags: "smoke" },
    ],
  });

  const controller = createGaugeExecutionController({
    vscode,
    cli,
    pathModule: path.posix,
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/build.gradle.kts";
      },
    },
    projectFactory: {
      get(root) {
        assert.equal(root, "/workspace");
        return {
          getExecutionCommand(candidateCli) {
            receivedCli = candidateCli;
            return executionCommand;
          },
          root() {
            return root;
          },
        };
      },
      getGaugeRootFromFilePath() {
        return "/workspace";
      },
      isGaugeProject() {
        return true;
      },
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  const result = await controller.handleCommand("gauge.execute.specification");

  assert.equal(result, true);
  assert.equal(receivedCli, cli);
  assert.equal(calls[0].command, "./gradlew");
  assert.equal(calls[0].tool, executionCommand);
  assert.deepEqual(calls[0].args, [
    "clean",
    "gauge",
    "-Ptags=smoke",
    "-PadditionalFlags=--hide-suggestion --simple-console",
    "-PspecsDir=specs/example.spec",
  ]);
});

test("execute specification runs Explorer selected spec files and directories", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const directories = new Set([
    "/workspace/specs/features",
  ]);
  const files = new Set([
    "/workspace/specs/a.spec",
    "/workspace/specs/features/b.spec",
  ]);
  const { vscode } = createFakeVscode({
    launchConfigurations: [
      { type: "gauge", request: "test", name: "Gauge", tags: "smoke" },
    ],
  });

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/manifest.json"
          || directories.has(filename)
          || files.has(filename);
      },
      readdirSync(filename) {
        if (filename === "/workspace/specs/features") {
          return ["b.spec"];
        }
        return [];
      },
      statSync(filename) {
        return {
          isDirectory() {
            return directories.has(filename);
          },
        };
      },
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  const result = await controller.handleCommand(
    "gauge.execute.specification",
    { fsPath: "/workspace/specs/a.spec" },
    [
      { fsPath: "/workspace/specs/a.spec" },
      { fsPath: "/workspace/specs/features" },
      { fsPath: "/workspace/notes.txt" },
    ],
  );

  assert.equal(result, true);
  assert.deepEqual(calls, [
    {
      command: "gauge",
      args: [
        "run",
        "--hide-suggestion",
        "--simple-console",
        "--tags",
        "smoke",
        "/workspace/specs/a.spec",
        "/workspace/specs/features",
      ],
      cwd: "/workspace",
      status: "/workspace/Specifications",
    },
  ]);
});

test("execute specification splits Explorer selected specs by project root", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const files = new Set([
    "/workspace/checkout/manifest.json",
    "/workspace/checkout/specs/checkout.spec",
    "/workspace/accounts/manifest.json",
    "/workspace/accounts/specs/accounts.spec",
  ]);
  const { vscode } = createFakeVscode({
    workspaceFolders: [
      { uri: { fsPath: "/workspace/checkout" } },
      { uri: { fsPath: "/workspace/accounts" } },
    ],
  });

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync(filename) {
        return files.has(filename);
      },
    },
    projectFactory: {
      get(root) {
        return {
          root() {
            return root;
          },
        };
      },
      getGaugeRootFromFilePath(filename) {
        if (filename.startsWith("/workspace/checkout/")) {
          return "/workspace/checkout";
        }
        if (filename.startsWith("/workspace/accounts/")) {
          return "/workspace/accounts";
        }
        return undefined;
      },
      isGaugeProject(root) {
        return root === "/workspace/checkout" || root === "/workspace/accounts";
      },
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  const result = await controller.handleCommand(
    "gauge.execute.specification",
    { fsPath: "/workspace/checkout/specs/checkout.spec" },
    [
      { fsPath: "/workspace/checkout/specs/checkout.spec" },
      { fsPath: "/workspace/accounts/specs/accounts.spec" },
    ],
  );

  assert.equal(result, true);
  assert.deepEqual(calls, [
    {
      command: "gauge",
      args: [
        "run",
        "--hide-suggestion",
        "--simple-console",
        "/workspace/checkout/specs/checkout.spec",
      ],
      cwd: "/workspace/checkout",
      status: "/workspace/checkout/Specifications",
    },
    {
      command: "gauge",
      args: [
        "run",
        "--hide-suggestion",
        "--simple-console",
        "/workspace/accounts/specs/accounts.spec",
      ],
      cwd: "/workspace/accounts",
      status: "/workspace/accounts/Specifications",
    },
  ]);
});

test("execute specification runs all specs when Explorer selected resource is the project root", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const directories = new Set([
    "/workspace",
    "/workspace/specs",
  ]);
  const files = new Set([
    "/workspace/manifest.json",
    "/workspace/specs/example.spec",
  ]);
  const { vscode } = createFakeVscode();

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync(filename) {
        return directories.has(filename) || files.has(filename);
      },
      readdirSync(filename) {
        if (filename === "/workspace") {
          return ["manifest.json", "specs"];
        }
        if (filename === "/workspace/specs") {
          return ["example.spec"];
        }
        return [];
      },
      statSync(filename) {
        return {
          isDirectory() {
            return directories.has(filename);
          },
        };
      },
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  const result = await controller.handleCommand(
    "gauge.execute.specification",
    { fsPath: "/workspace" },
    [{ fsPath: "/workspace" }],
  );

  assert.equal(result, true);
  assert.deepEqual(calls, [
    {
      command: "gauge",
      args: [
        "run",
        "--hide-suggestion",
        "--simple-console",
      ],
      cwd: "/workspace",
      status: "/workspace/All specs",
    },
  ]);
});

test("execute Maven specification compiles the project and runs Gauge directly", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const classpathCalls = [];
  const calls = [];
  const gaugeCommand = {
    command: "gauge",
    argsForSpawnType(args) {
      return args;
    },
  };
  const mavenCommand = {
    command: "mvn",
    argsForSpawnType(args) {
      return args;
    },
  };
  const gradleCommand = {
    command: "gradle",
    argsForSpawnType(args) {
      return args;
    },
  };
  const { vscode } = createFakeVscode({
    launchConfigurations: [
      { type: "gauge", request: "test", name: "Gauge", tags: "smoke" },
    ],
  });

  const controller = createGaugeExecutionController({
    vscode,
    cli: {
      gaugeCommand() {
        return gaugeCommand;
      },
      mavenCommand() {
        return mavenCommand;
      },
      gradleCommand() {
        return gradleCommand;
      },
    },
    pathModule: path.posix,
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/manifest.json"
          || filename === "/workspace/pom.xml"
          || filename === "/workspace/build.gradle.kts";
      },
      readFileSync(filename) {
        assert.equal(filename, "/workspace/manifest.json");
        return Buffer.from(JSON.stringify({ Language: "kotlin" }));
      },
    },
    execSync(command, options) {
      classpathCalls.push({ command, options });
      return Buffer.from("/workspace/target/test-classes\n");
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  const result = await controller.handleCommand("gauge.execute.specification");

  assert.equal(result, true);
  assert.deepEqual(classpathCalls, [
    {
      command: "mvn -q test-compile",
      options: { cwd: "/workspace" },
    },
    {
      command: "mvn -q gauge:classpath",
      options: { cwd: "/workspace" },
    },
  ]);
  assert.deepEqual(calls, [
    {
      command: "gauge",
      tool: gaugeCommand,
      args: [
        "run",
        "--hide-suggestion",
        "--simple-console",
        "--tags",
        "smoke",
        "/workspace/specs/example.spec",
      ],
      cwd: "/workspace",
      env: {
        ...process.env,
        gauge_custom_classpath: "/workspace/target/test-classes",
      },
      status: "/workspace/specs/example.spec",
    },
  ]);
});

test("execute specification resolves the project root from the active Gauge file", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const classpathCalls = [];
  const calls = [];
  const gaugeCommand = {
    command: "/tools/gauge",
    argsForSpawnType(args) {
      return args;
    },
  };
  const { errors, vscode } = createFakeVscode({
    activeTextEditor: {
      document: {
        fileName: "/outside/gauge/specs/example.spec",
        uri: { fsPath: "/outside/gauge/specs/example.spec" },
      },
    },
    launchConfigurations: [
      { type: "gauge", request: "test", name: "Gauge", tags: "smoke" },
    ],
    workspaceFolders: [],
  });

  const controller = createGaugeExecutionController({
    vscode,
    cli: {
      gaugeCommand() {
        return gaugeCommand;
      },
      gradleCommand() {
        return { command: "./gradlew" };
      },
    },
    pathModule: path.posix,
    fileSystem: {
      existsSync(filename) {
        return filename === "/outside/gauge/manifest.json"
          || filename === "/outside/gauge/build.gradle.kts";
      },
      readFileSync(filename) {
        assert.equal(filename, "/outside/gauge/manifest.json");
        return Buffer.from(JSON.stringify({ Language: "kotlin", Plugins: [] }));
      },
    },
    execSync(command, options) {
      classpathCalls.push({ command, options });
      return Buffer.from("/outside/gauge/build/classes/kotlin/test\n");
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  const result = await controller.handleCommand("gauge.execute.specification");

  assert.equal(result, true);
  assert.deepEqual(errors, []);
  assert.deepEqual(classpathCalls, [
    {
      command: "gradle -q testClasses",
      options: { cwd: "/outside/gauge" },
    },
    {
      command: "gradle -q classpath --rerun",
      options: { cwd: "/outside/gauge" },
    },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "/tools/gauge");
  assert.equal(calls[0].tool, gaugeCommand);
  assert.deepEqual(calls[0].args, [
    "run",
    "--hide-suggestion",
    "--simple-console",
    "--tags",
    "smoke",
    "/outside/gauge/specs/example.spec",
  ]);
  assert.equal(calls[0].cwd, "/outside/gauge");
  assert.deepEqual(calls[0].env, {
    ...process.env,
    gauge_custom_classpath: "/outside/gauge/build/classes/kotlin/test",
  });
  assert.equal(calls[0].status, "/outside/gauge/specs/example.spec");
});

test("execute specification ignores active specs when the resolved root is not a Gauge project", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const { errors, vscode } = createFakeVscode({
    activeTextEditor: {
      document: {
        fileName: "/workspace/notes/example.spec",
        uri: { fsPath: "/workspace/notes/example.spec" },
      },
    },
    workspaceFolders: [],
  });

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/notes/example.spec");
        return "/workspace/notes";
      },
      isGaugeProject(root) {
        assert.equal(root, "/workspace/notes");
        return false;
      },
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  const result = await controller.handleCommand("gauge.execute.specification");

  assert.equal(result, undefined);
  assert.deepEqual(calls, []);
  assert.deepEqual(errors, ["No workspace folder is open."]);
});

test("execute specification ignores active specs rejected by project root resolution", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const { errors, vscode } = createFakeVscode({
    activeTextEditor: {
      document: {
        fileName: "/workspace/notes/example.spec",
        uri: { fsPath: "/workspace/notes/example.spec" },
      },
    },
  });

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/notes/example.spec");
        throw new Error("not a Gauge project");
      },
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  const result = await controller.handleCommand("gauge.execute.specification");

  assert.equal(result, undefined);
  assert.deepEqual(calls, []);
  assert.deepEqual(errors, ["No workspace folder is open."]);
});

test("execute in parallel runs the selected Gauge target", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const { vscode } = createFakeVscode({
    activeTextEditor: {
      document: {
        fileName: "/workspace/specs/example.spec",
        uri: { fsPath: "/workspace/specs/example.spec" },
      },
    },
  });

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/manifest.json"
          || filename === "/workspace/build.gradle.kts";
      },
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  const result = await controller.handleCommand(
    "gauge.execute.inParallel",
    "/workspace/specs/example.spec",
  );

  assert.equal(result, true);
  assert.deepEqual(calls, [
    {
      command: "gradle",
      args: [
        "clean",
        "gauge",
        "-PinParallel=true",
        "-PadditionalFlags=--hide-suggestion --simple-console",
        "-PspecsDir=specs/example.spec",
      ],
      cwd: "/workspace",
      status: "/workspace/specs/example.spec",
    },
  ]);
});

test("bare execution commands run the active project without a spec target", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const debugProjects = [];
  const { vscode } = createFakeVscode();

  const controller = createGaugeExecutionController({
    vscode,
    env: { PATH: "/bin" },
    pathModule: path.posix,
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/manifest.json"
          || filename === "/workspace/build.gradle.kts";
      },
    },
    debuggerFactory(options) {
      debugProjects.push(options.projectRoot);
      return {
        registerStopDebugger() {},
        async addDebugEnv(env) {
          return { ...env, GAUGE_DEBUG_OPTS: "debug" };
        },
      };
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  assert.equal(await controller.handleCommand("gauge.execute"), true);
  assert.equal(await controller.handleCommand("gauge.execute.inParallel"), true);
  assert.equal(await controller.handleCommand("gauge.debug"), true);

  assert.deepEqual(debugProjects, ["/workspace"]);
  assert.deepEqual(calls, [
    {
      command: "gradle",
      args: [
        "clean",
        "gauge",
        "-PadditionalFlags=--hide-suggestion --simple-console",
      ],
      cwd: "/workspace",
      status: "/workspace/All specs",
    },
    {
      command: "gradle",
      args: [
        "clean",
        "gauge",
        "-PinParallel=true",
        "-PadditionalFlags=--hide-suggestion --simple-console",
      ],
      cwd: "/workspace",
      status: "/workspace/All specs",
    },
    {
      command: "gradle",
      args: [
        "clean",
        "gauge",
        "-PadditionalFlags=--hide-suggestion --simple-console",
      ],
      cwd: "/workspace",
      status: "/workspace/All specs",
      env: {
        PATH: "/bin",
        GAUGE_DEBUG_OPTS: "debug",
      },
    },
  ]);
});

test("execute target uses the native Gauge console for Test UI runs", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const { vscode } = createFakeVscode({
    launchConfigurations: [
      {
        type: "gauge",
        request: "test",
        name: "Gauge",
        "hide-suggestion": false,
      },
    ],
  });

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/manifest.json";
      },
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  await controller.handleCommand("gauge.execute", "/workspace/specs/example.spec", {
    "hide-suggestion": true,
    "simple-console": false,
    testUi: true,
  });

  assert.deepEqual(calls[0].args, [
    "run",
    "--hide-suggestion",
    "/workspace/specs/example.spec",
  ]);
  assert.equal(calls[0].forwardOutput, true);
  assert.equal(calls[0].saveExecutionResult, true);
});

test("execute target passes project classpath environment to normal Gauge runs", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const envCalls = [];
  const { vscode } = createFakeVscode();
  const cli = { id: "cli" };

  const controller = createGaugeExecutionController({
    vscode,
    cli,
    env: { PATH: "/bin" },
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    projectFactory: {
      get(root) {
        assert.equal(root, "/workspace");
        return {
          envs(receivedCli) {
            envCalls.push(receivedCli);
            return { gauge_custom_classpath: "/workspace/gauge/out/test/gauge" };
          },
          getExecutionCommand(receivedCli) {
            assert.equal(receivedCli, cli);
            return undefined;
          },
          root() {
            return root;
          },
        };
      },
      getGaugeRootFromFilePath() {
        return "/workspace";
      },
      isGaugeProject() {
        return true;
      },
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  await controller.handleCommand("gauge.execute", "/workspace/specs/example.spec");

  assert.deepEqual(envCalls, [cli]);
  assert.deepEqual(calls, [
    {
      command: "gauge",
      args: [
        "run",
        "--hide-suggestion",
        "--simple-console",
        "/workspace/specs/example.spec",
      ],
      cwd: "/workspace",
      status: "/workspace/specs/example.spec",
      env: {
        PATH: "/bin",
        gauge_custom_classpath: "/workspace/gauge/out/test/gauge",
      },
    },
  ]);
});

test("execute failed asks for a project and runs failed scenarios there", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const { vscode, quickPicks } = createFakeVscode({
    workspaceFolders: [
      { uri: { fsPath: "/workspace/shop" } },
      { uri: { fsPath: "/workspace/admin" } },
    ],
    quickPickSelection: { label: "admin", description: "/workspace/admin" },
  });

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  await controller.handleCommand("gauge.execute.failed");

  assert.deepEqual(quickPicks, [
    {
      items: [
        { label: "shop", description: "/workspace/shop" },
        { label: "admin", description: "/workspace/admin" },
      ],
      options: { canPickMany: false, placeHolder: "Choose a project" },
    },
  ]);
  assert.deepEqual(calls, [
    {
      command: "gauge",
      args: ["run", "--failed"],
      cwd: "/workspace/admin",
      status: "/workspace/admin/failed scenarios",
    },
  ]);
});

test("execute failed asks for nested Gauge projects discovered under a workspace folder", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const { vscode, quickPicks } = createFakeVscode({
    workspaceFolders: [
      { uri: { fsPath: "/workspace" } },
    ],
    quickPickSelection: { label: "admin", description: "/workspace/admin" },
  });

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    projectFactory: {
      findGaugeProjectRoots(root) {
        assert.equal(root, "/workspace");
        return ["/workspace/shop", "/workspace/admin"];
      },
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  await controller.handleCommand("gauge.execute.failed");

  assert.deepEqual(quickPicks, [
    {
      items: [
        { label: "shop", description: "/workspace/shop" },
        { label: "admin", description: "/workspace/admin" },
      ],
      options: { canPickMany: false, placeHolder: "Choose a project" },
    },
  ]);
  assert.deepEqual(calls, [
    {
      command: "gauge",
      args: ["run", "--failed"],
      cwd: "/workspace/admin",
      status: "/workspace/admin/failed scenarios",
    },
  ]);
});

test("execute failed skips project prompt when only one workspace folder is a Gauge project", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const { vscode, quickPicks } = createFakeVscode({
    workspaceFolders: [
      { uri: { fsPath: "/workspace/gauge" } },
      { uri: { fsPath: "/workspace/docs" } },
    ],
  });

  const controller = createGaugeExecutionController({
    vscode,
    createCli() {
      return undefined;
    },
    pathModule: path.posix,
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/gauge/manifest.json";
      },
      readFileSync(filename) {
        assert.equal(filename, "/workspace/gauge/manifest.json");
        return Buffer.from(JSON.stringify({ Language: "kotlin" }));
      },
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  await controller.handleCommand("gauge.execute.failed");

  assert.deepEqual(quickPicks, []);
  assert.deepEqual(calls, [
    {
      command: "gauge",
      args: ["run", "--failed"],
      cwd: "/workspace/gauge",
      status: "/workspace/gauge/failed scenarios",
    },
  ]);
});

test("execute all specs asks for nested Gauge projects discovered under a workspace folder", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const { vscode, quickPicks } = createFakeVscode({
    workspaceFolders: [
      { uri: { fsPath: "/workspace" } },
    ],
    quickPickSelection: { label: "admin", description: "/workspace/admin" },
  });

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    projectFactory: {
      findGaugeProjectRoots(root) {
        assert.equal(root, "/workspace");
        return ["/workspace/shop", "/workspace/admin"];
      },
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  await controller.handleCommand("gauge.execute.specification.all");

  assert.deepEqual(quickPicks, [
    {
      items: [
        { label: "shop", description: "/workspace/shop" },
        { label: "admin", description: "/workspace/admin" },
      ],
      options: { canPickMany: false, placeHolder: "Choose a project" },
    },
  ]);
  assert.deepEqual(calls, [
    {
      command: "gauge",
      args: ["run", "--hide-suggestion", "--simple-console"],
      cwd: "/workspace/admin",
      status: "/workspace/admin/All specs",
    },
  ]);
});

test("execute all specs reads launch options from the selected workspace folder", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const configurationRequests = [];
  const workspaceFolderRequests = [];
  const workspaceFolder = { uri: { fsPath: "/workspace/admin" }, name: "admin" };
  const vscode = {
    Uri: {
      file(fsPath) {
        return { fsPath };
      },
    },
    workspace: {
      workspaceFolders: [
        { uri: { fsPath: "/workspace/shop" } },
        workspaceFolder,
      ],
      getWorkspaceFolder(uri) {
        workspaceFolderRequests.push(uri);
        return uri.fsPath === "/workspace/admin" ? workspaceFolder : undefined;
      },
      getConfiguration(section, scope) {
        if (section === "gauge") {
          return {
            get() {
              return undefined;
            },
          };
        }
        configurationRequests.push({ section, scope });
        return {
          get(key) {
            assert.equal(key, "configurations");
            return scope === workspaceFolder
              ? [{ type: "gauge", request: "test", name: "Gauge", tags: "admin" }]
              : [];
          },
        };
      },
    },
    window: {
      async showQuickPick(items) {
        return items[1];
      },
      async showErrorMessage() {},
    },
  };

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  await controller.handleCommand("gauge.execute.specification.all");

  assert.deepEqual(workspaceFolderRequests, [{ fsPath: "/workspace/admin" }]);
  assert.deepEqual(configurationRequests, [
    { section: "launch", scope: workspaceFolder },
  ]);
  assert.deepEqual(calls, [
    {
      command: "gauge",
      args: ["run", "--hide-suggestion", "--simple-console", "--tags", "admin"],
      cwd: "/workspace/admin",
      status: "/workspace/admin/All specs",
    },
  ]);
});

test("execute all failed and repeat fall back to the active Gauge project without workspace folders", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const { vscode, quickPicks } = createFakeVscode({
    activeTextEditor: {
      document: {
        fileName: "/standalone/specs/example.spec",
        uri: { fsPath: "/standalone/specs/example.spec" },
      },
    },
    workspaceFolders: [],
  });

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/standalone/specs/example.spec");
        return "/standalone";
      },
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  await controller.handleCommand("gauge.execute.specification.all");
  await controller.handleCommand("gauge.execute.failed");
  await controller.handleCommand("gauge.execute.repeat");

  assert.deepEqual(quickPicks, []);
  assert.deepEqual(calls, [
    {
      command: "gauge",
      args: ["run", "--hide-suggestion", "--simple-console"],
      cwd: "/standalone",
      status: "/standalone/All specs",
    },
    {
      command: "gauge",
      args: ["run", "--failed"],
      cwd: "/standalone",
      status: "/standalone/failed scenarios",
    },
    {
      command: "gauge",
      args: ["run", "--repeat"],
      cwd: "/standalone",
      status: "/standalone/previous run",
    },
  ]);
});

test("repeat execution asks for nested Gauge projects discovered under a workspace folder", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const { vscode, quickPicks } = createFakeVscode({
    workspaceFolders: [
      { uri: { fsPath: "/workspace" } },
    ],
    quickPickSelection: { label: "admin", description: "/workspace/admin" },
  });

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    projectFactory: {
      findGaugeProjectRoots(root) {
        assert.equal(root, "/workspace");
        return ["/workspace/shop", "/workspace/admin"];
      },
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  await controller.handleCommand("gauge.execute.repeat");

  assert.deepEqual(quickPicks, [
    {
      items: [
        { label: "shop", description: "/workspace/shop" },
        { label: "admin", description: "/workspace/admin" },
      ],
      options: { canPickMany: false, placeHolder: "Choose a project" },
    },
  ]);
  assert.deepEqual(calls, [
    {
      command: "gauge",
      args: ["run", "--repeat"],
      cwd: "/workspace/admin",
      status: "/workspace/admin/previous run",
    },
  ]);
});

test("failed and repeat execution accept command flags for Test UI events", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const { vscode } = createFakeVscode({
    workspaceFolders: [
      { uri: { fsPath: "/workspace" } },
    ],
  });
  const flags = {
    "hide-suggestion": true,
    "machine-readable": true,
  };

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  await controller.handleCommand("gauge.execute.failed", undefined, flags);
  await controller.handleCommand("gauge.execute.repeat", undefined, flags);

  assert.deepEqual(calls, [
    {
      command: "gauge",
      args: ["run", "--failed", "--hide-suggestion", "--machine-readable"],
      cwd: "/workspace",
      status: "/workspace/failed scenarios",
    },
    {
      command: "gauge",
      args: ["run", "--repeat", "--hide-suggestion", "--machine-readable"],
      cwd: "/workspace",
      status: "/workspace/previous run",
    },
  ]);
});

test("failed execution uses the provided project root without prompting", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const { vscode, quickPicks } = createFakeVscode({
    workspaceFolders: [
      { uri: { fsPath: "/workspace/shop" } },
      { uri: { fsPath: "/workspace/admin" } },
    ],
  });

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  await controller.handleCommand("gauge.execute.failed", {
    projectRoot: "/workspace/admin",
  }, {
    "hide-suggestion": true,
    "machine-readable": true,
  });

  assert.deepEqual(quickPicks, []);
  assert.deepEqual(calls, [
    {
      command: "gauge",
      args: ["run", "--failed", "--hide-suggestion", "--machine-readable"],
      cwd: "/workspace/admin",
      status: "/workspace/admin/failed scenarios",
    },
  ]);
});

test("repeat execution uses the provided project root without prompting", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const { vscode, quickPicks } = createFakeVscode({
    workspaceFolders: [
      { uri: { fsPath: "/workspace/shop" } },
      { uri: { fsPath: "/workspace/admin" } },
    ],
  });

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  await controller.handleCommand("gauge.execute.repeat", {
    projectRoot: "/workspace/admin",
  }, {
    "hide-suggestion": true,
    "machine-readable": true,
  });

  assert.deepEqual(quickPicks, []);
  assert.deepEqual(calls, [
    {
      command: "gauge",
      args: ["run", "--repeat", "--hide-suggestion", "--machine-readable"],
      cwd: "/workspace/admin",
      status: "/workspace/admin/previous run",
    },
  ]);
});

test("spec explorer run all executes the active project without prompting", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const { vscode, quickPicks } = createFakeVscode({
    workspaceFolders: [
      { uri: { fsPath: "/workspace/shop" } },
      { uri: { fsPath: "/workspace/admin" } },
    ],
  });

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  await controller.handleCommand("gauge.specexplorer.runAllActiveProjectSpecs", {
    projectRoot: "/workspace/admin",
  });

  assert.deepEqual(quickPicks, []);
  assert.deepEqual(calls, [
    {
      command: "gauge",
      args: ["run", "--hide-suggestion", "--simple-console"],
      cwd: "/workspace/admin",
      status: "/workspace/admin/All specs",
    },
  ]);
});

test("execute specification runs the provided spec explorer node", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const { vscode } = createFakeVscode({
    workspaceFolders: [
      { uri: { fsPath: "/workspace/shop" } },
      { uri: { fsPath: "/workspace/admin" } },
    ],
  });

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  await controller.handleCommand("gauge.execute.specification", {
    file: "/workspace/admin/specs/checkout.spec",
  });

  assert.deepEqual(calls, [
    {
      command: "gauge",
      args: [
        "run",
        "--hide-suggestion",
        "--simple-console",
        "/workspace/admin/specs/checkout.spec",
      ],
      cwd: "/workspace/admin",
      status: "/workspace/admin/specs/checkout.spec",
    },
  ]);
});

test("execute scenario runs the provided spec explorer node", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const scenarioRequests = [];
  const { vscode } = createFakeVscode({
    workspaceFolders: [
      { uri: { fsPath: "/workspace/shop" } },
      { uri: { fsPath: "/workspace/admin" } },
    ],
  });

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    async scenariosProvider(request) {
      scenarioRequests.push(request);
      return {
        heading: "Should not be used",
        executionIdentifier: "/workspace/shop/specs/example.spec:3",
      };
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  await controller.handleCommand("gauge.execute.scenario", {
    file: "/workspace/admin/specs/checkout.spec",
    executionIdentifier: "/workspace/admin/specs/checkout.spec:12",
  });

  assert.deepEqual(scenarioRequests, []);
  assert.deepEqual(calls, [
    {
      command: "gauge",
      args: [
        "run",
        "--hide-suggestion",
        "--simple-console",
        "/workspace/admin/specs/checkout.spec:12",
      ],
      cwd: "/workspace/admin",
      status: "/workspace/admin/specs/checkout.spec",
    },
  ]);
});

test("execute node resolves Windows drive-letter spec paths to the matching workspace", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const otherRoot = "C:\\other";
  const projectRoot = "C:\\workspace";
  const spec = path.win32.join(projectRoot, "specs", "checkout.spec");
  const { vscode } = createFakeVscode({
    workspaceFolders: [
      { uri: { fsPath: otherRoot } },
      { uri: { fsPath: projectRoot } },
    ],
  });

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.win32,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  await controller.handleCommand("gauge.specexplorer.runNode", {
    file: spec,
  });

  assert.deepEqual(calls, [
    {
      command: "gauge",
      args: ["run", "--hide-suggestion", "--simple-console", spec],
      cwd: projectRoot,
      status: spec,
    },
  ]);
});

test("executor stops the active run and starts the newest request", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const lifecycle = [];
  const runs = [];
  const { vscode, errors } = createFakeVscode();

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    runner(command) {
      let finish;
      const run = new Promise((resolve) => {
        finish = resolve;
      });
      const record = {
        cancelCalls: 0,
        command,
        finish,
      };
      run.cancel = () => {
        record.cancelCalls += 1;
        finish(false);
      };
      runs.push(record);
      return run;
    },
  });

  const firstRun = controller.handleCommandWithMetadata(
    "gauge.execute.specification.all",
    {
      onStart() {
        lifecycle.push("first:start");
      },
      onSuperseded() {
        lifecycle.push("first:superseded");
      },
    },
    undefined,
  );
  await Promise.resolve();
  const secondRun = controller.handleCommandWithMetadata(
    "gauge.execute",
    {
      onStart() {
        lifecycle.push("latest:start");
      },
    },
    "/workspace/specs/latest.spec",
  );

  assert.equal(runs[0].cancelCalls, 1);
  assert.deepEqual(lifecycle, ["first:start", "first:superseded"]);
  assert.equal(await firstRun, false);
  await Promise.resolve();
  assert.equal(runs.length, 2);
  assert.deepEqual(lifecycle, ["first:start", "first:superseded", "latest:start"]);
  assert.equal(runs[1].command.status, "/workspace/specs/latest.spec");

  runs[1].finish(true);

  assert.equal(await secondRun, true);
  assert.deepEqual(errors, []);
});

test("executor keeps only the latest request while the active run is stopping", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const runs = [];
  const { vscode, errors } = createFakeVscode();

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    runner(command) {
      let finish;
      const run = new Promise((resolve) => {
        finish = resolve;
      });
      const record = {
        cancelCalls: 0,
        command,
        finish,
      };
      run.cancel = () => {
        record.cancelCalls += 1;
      };
      runs.push(record);
      return run;
    },
  });

  const firstRun = controller.handleCommand("gauge.execute.specification.all");
  await Promise.resolve();
  const supersededRun = controller.handleCommand(
    "gauge.execute",
    "/workspace/specs/superseded.spec",
  );
  const latestRun = controller.handleCommand(
    "gauge.execute",
    "/workspace/specs/latest.spec",
  );

  assert.equal(runs[0].cancelCalls, 1);
  assert.equal(await supersededRun, undefined);
  assert.equal(runs.length, 1);

  runs[0].finish(false);
  assert.equal(await firstRun, false);
  await Promise.resolve();

  assert.equal(runs.length, 2);
  assert.equal(runs[1].command.status, "/workspace/specs/latest.spec");
  runs[1].finish(true);

  assert.equal(await latestRun, true);
  assert.deepEqual(errors, []);
});

test("executor skips a superseded run that is still preparing", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const firstSaveEntered = deferred();
  const firstSave = deferred();
  const lifecycle = [];
  let saveCalls = 0;
  const runnerCalls = [];
  const { vscode, errors } = createFakeVscode({
    saveAll() {
      saveCalls += 1;
      if (saveCalls === 1) {
        firstSaveEntered.resolve();
        return firstSave.promise;
      }
      return Promise.resolve(true);
    },
  });

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    async runner(command) {
      runnerCalls.push(command);
      return true;
    },
  });

  let firstOutcome = { status: "pending" };
  const firstRun = controller.handleCommandWithMetadata(
    "gauge.execute.specification.all",
    {
      onStart() {
        lifecycle.push("first:start");
      },
      onSuperseded() {
        lifecycle.push("first:superseded");
      },
    },
  );
  firstRun.then((value) => {
    firstOutcome = { status: "fulfilled", value };
  });
  await firstSaveEntered.promise;
  let middleOutcome = { status: "pending" };
  const middleRun = controller.handleCommandWithMetadata(
    "gauge.execute",
    {
      onSuperseded() {
        lifecycle.push("middle:superseded");
      },
    },
    "/workspace/specs/middle.spec",
  );
  middleRun.then((value) => {
    middleOutcome = { status: "fulfilled", value };
  });
  let latestOutcome = { status: "pending" };
  const latestRun = controller.handleCommand(
    "gauge.execute",
    "/workspace/specs/latest.spec",
  );
  latestRun.then((value) => {
    latestOutcome = { status: "fulfilled", value };
  });
  await new Promise((resolve) => setImmediate(resolve));
  const beforeBorrowedSaveSettlement = {
    firstOutcome,
    latestOutcome,
    lifecycle: [...lifecycle],
    middleOutcome,
    runnerStatuses: runnerCalls.map((command) => command.status),
    saveCalls,
  };

  firstSave.resolve(true);
  const settlements = await Promise.all([firstRun, middleRun, latestRun]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(beforeBorrowedSaveSettlement, {
    firstOutcome: { status: "fulfilled", value: undefined },
    latestOutcome: { status: "pending" },
    lifecycle: ["first:start", "first:superseded", "middle:superseded"],
    middleOutcome: { status: "fulfilled", value: undefined },
    runnerStatuses: [],
    saveCalls: 1,
  });
  assert.deepEqual(settlements, [undefined, undefined, true]);
  assert.deepEqual(runnerCalls.map((command) => command.status), [
    "/workspace/specs/latest.spec",
  ]);
  assert.deepEqual(errors, []);
});

test("executor releases a stopped build preparation while preserving the scheduler barrier", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const buildEntered = deferred();
  const firstBuild = deferred();
  const firstBuildError = new Error("cancelled build failed");
  const lifecycle = [];
  const runnerCalls = [];
  let environmentCalls = 0;
  const { errors, vscode } = createFakeVscode();
  const project = {
    executionEnvsAsync() {},
  };
  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
    projectFactory: {
      get() {
        return project;
      },
    },
    projectEnvironmentService: {
      executionEnvironmentFor() {
        environmentCalls += 1;
        if (environmentCalls === 1) {
          buildEntered.resolve();
          return firstBuild.promise;
        }
        return Promise.resolve({});
      },
    },
    async runner(command) {
      runnerCalls.push(command);
      return true;
    },
  });

  let stoppedOutcome = { status: "pending" };
  const stopped = controller.handleCommandWithMetadata(
    "gauge.execute.specification.all",
    {
      onCancelled: () => lifecycle.push("stopped:cancelled"),
      onStart: () => lifecycle.push("stopped:start"),
    },
  );
  stopped.then((value) => {
    stoppedOutcome = { status: "fulfilled", value };
  });
  await buildEntered.promise;
  await controller.stopExecution();

  let latestOutcome = { status: "pending" };
  const latest = controller.handleCommand(
    "gauge.execute",
    "/workspace/specs/latest.spec",
  );
  latest.then((value) => {
    latestOutcome = { status: "fulfilled", value };
  });
  await new Promise((resolve) => setImmediate(resolve));
  const beforeBuildSettlement = {
    environmentCalls,
    latestOutcome,
    lifecycle: [...lifecycle],
    runnerCalls: runnerCalls.length,
    stoppedOutcome,
  };

  firstBuild.reject(firstBuildError);
  const settlements = await Promise.all([stopped, latest]);
  controller.dispose();

  assert.deepEqual(beforeBuildSettlement, {
    environmentCalls: 1,
    latestOutcome: { status: "pending" },
    lifecycle: ["stopped:start", "stopped:cancelled"],
    runnerCalls: 0,
    stoppedOutcome: { status: "fulfilled", value: undefined },
  });
  assert.deepEqual(settlements, [undefined, true]);
  assert.equal(environmentCalls, 2);
  assert.deepEqual(runnerCalls.map((command) => command.status), [
    "/workspace/specs/latest.spec",
  ]);
  assert.deepEqual(errors, []);
});

test("executor closes debugger preparation when stopped before the run starts", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const debugEnvironmentEntered = deferred();
  const debugEnvironment = deferred();
  const lateDebugError = new Error("cancelled debug environment failed");
  const lifecycle = [];
  let debugSubscriptionDisposals = 0;
  let debuggerStopCalls = 0;
  let runnerCalls = 0;
  const { errors, vscode } = createFakeVscode();
  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
    debuggerFactory() {
      return {
        addDebugEnv() {
          debugEnvironmentEntered.resolve();
          return debugEnvironment.promise;
        },
        registerStopDebugger() {
          return {
            dispose() {
              debugSubscriptionDisposals += 1;
            },
          };
        },
        stopDebugger() {
          debuggerStopCalls += 1;
          return Promise.resolve(undefined);
        },
      };
    },
    async runner() {
      runnerCalls += 1;
      return true;
    },
  });

  let executionOutcome = { status: "pending" };
  const execution = controller.handleCommandWithMetadata(
    "gauge.specexplorer.debugNode",
    {
      onCancelled: () => lifecycle.push("cancelled"),
      onStart: () => lifecycle.push("start"),
    },
    {
      file: "/workspace/specs/example.spec",
      executionIdentifier: "/workspace/specs/example.spec:9",
    },
    { debug: true },
  );
  execution.then((value) => {
    executionOutcome = { status: "fulfilled", value };
  });
  await debugEnvironmentEntered.promise;
  await controller.stopExecution();
  let latestOutcome = { status: "pending" };
  const latest = controller.handleCommand(
    "gauge.execute",
    "/workspace/specs/latest.spec",
  );
  latest.then((value) => {
    latestOutcome = { status: "fulfilled", value };
  });
  await new Promise((resolve) => setImmediate(resolve));
  const beforeDebugEnvironmentSettlement = {
    debugSubscriptionDisposals,
    debuggerStopCalls,
    executionOutcome,
    latestOutcome,
    lifecycle: [...lifecycle],
    runnerCalls,
  };

  debugEnvironment.reject(lateDebugError);
  assert.equal(await execution, undefined);
  assert.equal(await latest, true);
  await new Promise((resolve) => setImmediate(resolve));
  controller.dispose();

  assert.deepEqual(beforeDebugEnvironmentSettlement, {
    debugSubscriptionDisposals: 1,
    debuggerStopCalls: 1,
    executionOutcome: { status: "fulfilled", value: undefined },
    latestOutcome: { status: "pending" },
    lifecycle: ["start", "cancelled"],
    runnerCalls: 0,
  });
  assert.equal(debugSubscriptionDisposals, 1);
  assert.equal(debuggerStopCalls, 1);
  assert.equal(runnerCalls, 1);
  assert.deepEqual(errors, []);
});

test("executor closes debugger ownership after synchronous preparation cancellation", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");

  for (const cancellationPoint of ["factory", "registration"]) {
    const debugEnvironment = deferred();
    const lifecycle = [];
    let debugEnvironmentCalls = 0;
    let debuggerStopCalls = 0;
    let registerCalls = 0;
    let runnerCalls = 0;
    let subscriptionDisposals = 0;
    let controller;
    const { vscode } = createFakeVscode();
    controller = createGaugeExecutionController({
      vscode,
      pathModule: path.posix,
      fileSystem: { existsSync: () => false },
      debuggerFactory() {
        if (cancellationPoint === "factory") {
          controller.stopExecution();
        }
        return {
          addDebugEnv() {
            debugEnvironmentCalls += 1;
            return debugEnvironment.promise;
          },
          registerStopDebugger(callback) {
            registerCalls += 1;
            if (cancellationPoint === "registration") {
              callback();
            }
            return {
              dispose() {
                subscriptionDisposals += 1;
              },
            };
          },
          stopDebugger() {
            debuggerStopCalls += 1;
          },
        };
      },
      async runner() {
        runnerCalls += 1;
        return true;
      },
    });

    let executionOutcome = { status: "pending" };
    const execution = controller.handleCommandWithMetadata(
      "gauge.specexplorer.debugNode",
      {
        onCancelled: () => lifecycle.push("cancelled"),
        onStart: () => lifecycle.push("start"),
      },
      {
        file: "/workspace/specs/example.spec",
        executionIdentifier: "/workspace/specs/example.spec:9",
      },
      { debug: true },
    );
    execution.then((value) => {
      executionOutcome = { status: "fulfilled", value };
    });
    await new Promise((resolve) => setImmediate(resolve));
    const snapshot = {
      debugEnvironmentCalls,
      debuggerStopCalls,
      executionOutcome,
      lifecycle: [...lifecycle],
      registerCalls,
      runnerCalls,
      subscriptionDisposals,
    };

    debugEnvironment.resolve({});
    await execution;
    await new Promise((resolve) => setImmediate(resolve));
    controller.dispose();

    assert.deepEqual(snapshot, {
      debugEnvironmentCalls: 0,
      debuggerStopCalls: 1,
      executionOutcome: { status: "fulfilled", value: undefined },
      lifecycle: ["start", "cancelled"],
      registerCalls: cancellationPoint === "factory" ? 0 : 1,
      runnerCalls: 0,
      subscriptionDisposals: cancellationPoint === "factory" ? 0 : 1,
    });
    assert.equal(debuggerStopCalls, 1);
    assert.equal(runnerCalls, 0);
  }
});

test("executor preserves live build and debug preparation failures", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");

  for (const preparation of ["build", "debug"]) {
    const preparationError = new Error(`live ${preparation} preparation failed`);
    const { vscode } = createFakeVscode();
    const project = {
      executionEnvsAsync() {},
    };
    const controller = createGaugeExecutionController({
      vscode,
      pathModule: path.posix,
      fileSystem: { existsSync: () => false },
      projectFactory: preparation === "build"
        ? {
          get() {
            return project;
          },
        }
        : undefined,
      projectEnvironmentService: preparation === "build"
        ? {
          executionEnvironmentFor() {
            return Promise.reject(preparationError);
          },
        }
        : undefined,
      debuggerFactory: preparation === "debug"
        ? () => ({
          addDebugEnv() {
            return Promise.reject(preparationError);
          },
          registerStopDebugger() {
            return { dispose() {} };
          },
          stopDebugger() {},
        })
        : undefined,
    });

    const execution = preparation === "build"
      ? controller.handleCommand("gauge.execute.specification.all")
      : controller.handleCommand(
        "gauge.specexplorer.debugNode",
        {
          file: "/workspace/specs/example.spec",
          executionIdentifier: "/workspace/specs/example.spec:9",
        },
        { debug: true },
      );

    await assert.rejects(execution, (error) => error === preparationError);
    controller.dispose();
  }
});

test("executor owns a run cancelled synchronously while the runner starts", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const runResponse = deferred();
  const lifecycle = [];
  const cancelArguments = [];
  let cancelCalls = 0;
  let cancellationObservations = 0;
  let controller;
  const { vscode } = createFakeVscode();
  controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
    runner() {
      controller.stopExecution();
      controller.stopExecution();
      const run = runResponse.promise;
      run.cancel = (aborted) => {
        cancelCalls += 1;
        cancelArguments.push(aborted);
        return {
          then(_resolve, reject) {
            cancellationObservations += 1;
            reject(new Error("runner startup cancellation failed"));
          },
        };
      };
      return run;
    },
  });

  let executionOutcome = { status: "pending" };
  const execution = controller.handleCommandWithMetadata(
    "gauge.execute.specification.all",
    {
      onCancelled: () => lifecycle.push("cancelled"),
      onStart: () => lifecycle.push("start"),
    },
  );
  execution.then((value) => {
    executionOutcome = { status: "fulfilled", value };
  });
  await new Promise((resolve) => setImmediate(resolve));
  const beforeRunSettlement = {
    cancelCalls,
    cancellationObservations,
    executionOutcome,
    lifecycle: [...lifecycle],
  };

  runResponse.resolve(false);
  const result = await execution;
  controller.dispose();

  assert.deepEqual(beforeRunSettlement, {
    cancelCalls: 1,
    cancellationObservations: 1,
    executionOutcome: { status: "pending" },
    lifecycle: ["start", "cancelled"],
  });
  assert.equal(result, false);
  assert.equal(cancelCalls, 1);
  assert.deepEqual(cancelArguments, [true]);
});

test("executor owns a run superseded synchronously while the runner starts", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const firstRunnerEntered = deferred();
  const firstRunResponse = deferred();
  const lifecycle = [];
  const runnerStatuses = [];
  let cancelCalls = 0;
  let controller;
  let latestExecution;
  const { vscode } = createFakeVscode();
  controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
    runner(command) {
      runnerStatuses.push(command.status);
      if (runnerStatuses.length === 1) {
        latestExecution = controller.handleCommand(
          "gauge.execute",
          "/workspace/specs/latest.spec",
        );
        firstRunnerEntered.resolve();
        const run = firstRunResponse.promise;
        run.cancel = () => {
          cancelCalls += 1;
        };
        return run;
      }
      return Promise.resolve(true);
    },
  });

  let firstOutcome = { status: "pending" };
  const firstExecution = controller.handleCommandWithMetadata(
    "gauge.execute.specification.all",
    {
      onStart: () => lifecycle.push("start"),
      onSuperseded: () => lifecycle.push("superseded"),
    },
  );
  firstExecution.then((value) => {
    firstOutcome = { status: "fulfilled", value };
  });
  await firstRunnerEntered.promise;
  let latestOutcome = { status: "pending" };
  latestExecution.then((value) => {
    latestOutcome = { status: "fulfilled", value };
  });
  await new Promise((resolve) => setImmediate(resolve));
  const beforeFirstRunSettlement = {
    cancelCalls,
    firstOutcome,
    latestOutcome,
    lifecycle: [...lifecycle],
    runnerStatuses: [...runnerStatuses],
  };

  firstRunResponse.resolve(false);
  const settlements = await Promise.all([firstExecution, latestExecution]);
  controller.dispose();

  assert.deepEqual(beforeFirstRunSettlement, {
    cancelCalls: 1,
    firstOutcome: { status: "pending" },
    latestOutcome: { status: "pending" },
    lifecycle: ["start", "superseded"],
    runnerStatuses: ["/workspace/All specs"],
  });
  assert.deepEqual(settlements, [false, true]);
  assert.deepEqual(runnerStatuses, [
    "/workspace/All specs",
    "/workspace/specs/latest.spec",
  ]);
});

test("executor preserves a synchronously superseded run when stop reporting throws", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const firstRunnerEntered = deferred();
  const firstRunResponse = deferred();
  const runnerStatuses = [];
  let cancelCalls = 0;
  let controller;
  let latestExecution;
  let notificationCalls = 0;
  const { vscode } = createFakeVscode();
  vscode.window.showErrorMessage = () => {
    notificationCalls += 1;
    throw new Error("stop notification failed");
  };
  controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
    runner(command) {
      runnerStatuses.push(command.status);
      if (runnerStatuses.length === 1) {
        latestExecution = controller.handleCommand(
          "gauge.execute",
          "/workspace/specs/latest.spec",
        );
        firstRunnerEntered.resolve();
        const run = firstRunResponse.promise;
        run.cancel = () => {
          cancelCalls += 1;
          throw new Error("runner cancellation failed");
        };
        return run;
      }
      return Promise.resolve(true);
    },
  });

  let firstOutcome = { status: "pending" };
  const firstExecution = controller.handleCommand("gauge.execute.specification.all");
  firstExecution.then(
    (value) => {
      firstOutcome = { status: "fulfilled", value };
    },
    (error) => {
      firstOutcome = { error, status: "rejected" };
    },
  );
  await firstRunnerEntered.promise;
  let latestOutcome = { status: "pending" };
  latestExecution.then((value) => {
    latestOutcome = { status: "fulfilled", value };
  });
  await new Promise((resolve) => setImmediate(resolve));
  const beforeFirstRunSettlement = {
    cancelCalls,
    firstOutcome,
    latestOutcome,
    notificationCalls,
    runnerStatuses: [...runnerStatuses],
  };

  firstRunResponse.resolve(false);
  const settlements = await Promise.allSettled([firstExecution, latestExecution]);
  controller.dispose();

  assert.deepEqual(beforeFirstRunSettlement, {
    cancelCalls: 1,
    firstOutcome: { status: "pending" },
    latestOutcome: { status: "pending" },
    notificationCalls: 1,
    runnerStatuses: ["/workspace/All specs"],
  });
  assert.deepEqual(settlements, [
    { status: "fulfilled", value: false },
    { status: "fulfilled", value: true },
  ]);
});

test("executor stop command clears the pending latest request", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const runs = [];
  const { vscode } = createFakeVscode();

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    runner(command) {
      let finish;
      const run = new Promise((resolve) => {
        finish = resolve;
      });
      run.cancel = () => {};
      runs.push({ command, finish });
      return run;
    },
  });

  const firstRun = controller.handleCommand("gauge.execute.specification.all");
  await Promise.resolve();
  const pendingRun = controller.handleCommand(
    "gauge.execute",
    "/workspace/specs/pending.spec",
  );

  await controller.handleCommand("gauge.stopExecution");
  assert.equal(await pendingRun, undefined);
  runs[0].finish(false);
  assert.equal(await firstRun, false);
  await Promise.resolve();

  assert.equal(runs.length, 1);
});

test("executor does not let an older resolving command replace a newer run", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  let finishOlderScenarioRequest;
  let scenarioRequests = 0;
  const olderScenarioRequest = new Promise((resolve) => {
    finishOlderScenarioRequest = resolve;
  });
  const runs = [];
  const runnerStarted = deferred();
  const { vscode } = createFakeVscode();

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    scenariosProvider() {
      scenarioRequests += 1;
      if (scenarioRequests === 1) {
        return olderScenarioRequest;
      }
      return Promise.resolve({
        executionIdentifier: "/workspace/specs/example.spec:9",
      });
    },
    runner(command) {
      let finish;
      const run = new Promise((resolve) => {
        finish = resolve;
      });
      const record = { cancelCalls: 0, command, finish };
      run.cancel = () => {
        record.cancelCalls += 1;
      };
      runs.push(record);
      runnerStarted.resolve();
      return run;
    },
  });

  const olderRun = controller.handleCommand("gauge.execute.scenario");
  await Promise.resolve();
  const latestRun = controller.handleCommand("gauge.execute.scenario");
  await runnerStarted.promise;

  assert.equal(runs.length, 1);
  assert.equal(runs[0].command.status, "/workspace/specs/example.spec:9");

  finishOlderScenarioRequest({
    executionIdentifier: "/workspace/specs/example.spec:3",
  });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(runs[0].cancelCalls, 0);
  assert.equal(await olderRun, undefined);
  runs[0].finish(true);
  assert.equal(await latestRun, true);
  assert.equal(runs.length, 1);
});

test("executor shows a stop status bar item while a run is active", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  let finish;
  const { statusBarItems, vscode } = createFakeVscode();

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    runner() {
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });

  const run = controller.handleCommand("gauge.execute.specification.all");
  await Promise.resolve();

  const stopItem = statusBarItems[0];
  assert.equal(stopItem.alignment, "left");
  assert.equal(stopItem.priority, 2);
  assert.equal(stopItem.command, "gauge.stopExecution");
  assert.equal(stopItem.tooltip, "Click to Stop Run");
  assert.equal(stopItem.text, "$(primitive-square) Running All specs");
  assert.equal(stopItem.showCalls, 1);

  finish(true);
  await run;

  assert.equal(stopItem.hideCalls, 1);
});

test("executor disposes execution status bar items", () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const { statusBarItems, vscode } = createFakeVscode();

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
  });

  controller.dispose();

  assert.deepEqual(statusBarItems.map((item) => item.disposeCalls), [1, 1]);
});

test("executor cancels active execution and rejects later work when disposed", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const lifecycle = [];
  const runnerCalls = [];
  const runnerStarted = deferred();
  let cancelCalls = 0;
  const { statusBarItems, vscode } = createFakeVscode();
  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
    runner(command) {
      runnerCalls.push(command);
      runnerStarted.resolve();
      const run = new Promise(() => {});
      run.cancel = (aborted) => {
        assert.equal(aborted, true);
        cancelCalls += 1;
      };
      return run;
    },
  });

  let activeOutcome;
  controller.handleCommandWithMetadata(
    "gauge.execute.specification.all",
    {
      onCancelled: () => lifecycle.push("active:cancelled"),
      onStart: () => lifecycle.push("active:start"),
      onSuperseded: () => lifecycle.push("active:superseded"),
    },
    undefined,
  ).then((value) => {
    activeOutcome = { status: "fulfilled", value };
  });
  await runnerStarted.promise;
  assert.equal(runnerCalls.length, 1);

  controller.dispose();
  controller.dispose();
  await Promise.resolve();

  let laterOutcome;
  controller.handleCommandWithMetadata(
    "gauge.execute.specification.all",
    {
      onCancelled: () => lifecycle.push("later:cancelled"),
      onStart: () => lifecycle.push("later:start"),
    },
    undefined,
  ).then((value) => {
    laterOutcome = { status: "fulfilled", value };
  });
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual({
    activeOutcome,
    cancelCalls,
    lifecycle,
    laterOutcome,
    runnerCalls: runnerCalls.length,
    statusDisposals: statusBarItems.map((item) => item.disposeCalls),
  }, {
    activeOutcome: { status: "fulfilled", value: undefined },
    cancelCalls: 1,
    lifecycle: ["active:start", "active:cancelled", "later:cancelled"],
    laterOutcome: { status: "fulfilled", value: undefined },
    runnerCalls: 1,
    statusDisposals: [1, 1],
  });
});

test("executor observes asynchronous debugger shutdown when disposed", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  for (const settlement of ["resolve", "reject"]) {
    const runnerEntered = deferred();
    let debugSubscriptionDisposals = 0;
    let debuggerShutdownObservations = 0;
    let runCancellationObservations = 0;
    const { vscode } = createFakeVscode();
    const controller = createGaugeExecutionController({
      vscode,
      pathModule: path.posix,
      fileSystem: { existsSync: () => false },
      debuggerFactory() {
        return {
          async addDebugEnv(env) {
            return env;
          },
          registerStopDebugger() {
            return {
              dispose() {
                debugSubscriptionDisposals += 1;
              },
            };
          },
          stopDebugger() {
            return {
              then(resolve, reject) {
                debuggerShutdownObservations += 1;
                if (settlement === "reject") {
                  reject(new Error("debug shutdown failed"));
                } else {
                  resolve(undefined);
                }
              },
            };
          },
        };
      },
      runner() {
        runnerEntered.resolve();
        const run = new Promise(() => {});
        run.cancel = () => ({
          then(resolve) {
            runCancellationObservations += 1;
            resolve(undefined);
          },
        });
        return run;
      },
    });

    const execution = controller.handleCommand("gauge.specexplorer.debugNode", {
      file: "/workspace/specs/example.spec",
      executionIdentifier: "/workspace/specs/example.spec:8",
    }, { debug: true });
    await runnerEntered.promise;
    controller.dispose();
    controller.dispose();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual({
      debugSubscriptionDisposals,
      debuggerShutdownObservations,
      execution: await execution,
      runCancellationObservations,
    }, {
      debugSubscriptionDisposals: 1,
      debuggerShutdownObservations: 1,
      execution: undefined,
      runCancellationObservations: 1,
    });
  }
});

test("executor cancels the run when debugger shutdown throws", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const runnerEntered = deferred();
  let debugSubscriptionDisposals = 0;
  let runCancellationCalls = 0;
  const { errors, vscode } = createFakeVscode();
  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
    debuggerFactory() {
      return {
        async addDebugEnv(env) {
          return env;
        },
        registerStopDebugger() {
          return {
            dispose() {
              debugSubscriptionDisposals += 1;
            },
          };
        },
        stopDebugger() {
          throw new Error("debug shutdown failed");
        },
      };
    },
    runner() {
      runnerEntered.resolve();
      const run = new Promise(() => {});
      run.cancel = () => {
        runCancellationCalls += 1;
        return Promise.resolve(undefined);
      };
      return run;
    },
  });

  const execution = controller.handleCommand("gauge.specexplorer.debugNode", {
    file: "/workspace/specs/example.spec",
    executionIdentifier: "/workspace/specs/example.spec:8",
  }, { debug: true });
  await runnerEntered.promise;

  controller.dispose();
  assert.equal(await execution, undefined);
  assert.equal(debugSubscriptionDisposals, 1);
  assert.deepEqual(errors, []);
  assert.equal(runCancellationCalls, 1);
});

test("executor observes debugger stop notifications while cancelling the run", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");

  for (const notificationFailure of ["throw", "reject"]) {
    const finish = deferred();
    const runnerEntered = deferred();
    let notificationCalls = 0;
    let notificationObservations = 0;
    let runCancellationCalls = 0;
    const { vscode } = createFakeVscode();
    vscode.window.showErrorMessage = () => {
      notificationCalls += 1;
      if (notificationFailure === "throw") {
        throw new Error("notification failed");
      }
      return {
        then(_resolve, reject) {
          notificationObservations += 1;
          reject(new Error("notification failed"));
        },
      };
    };
    const controller = createGaugeExecutionController({
      vscode,
      pathModule: path.posix,
      fileSystem: { existsSync: () => false },
      debuggerFactory() {
        return {
          async addDebugEnv(env) {
            return env;
          },
          registerStopDebugger() {
            return { dispose() {} };
          },
          stopDebugger() {
            throw new Error("debug shutdown failed");
          },
        };
      },
      runner() {
        runnerEntered.resolve();
        const run = finish.promise;
        run.cancel = () => {
          runCancellationCalls += 1;
          finish.resolve(false);
          return Promise.resolve(undefined);
        };
        return run;
      },
    });
    const execution = controller.handleCommand("gauge.specexplorer.debugNode", {
      file: "/workspace/specs/example.spec",
      executionIdentifier: "/workspace/specs/example.spec:8",
    }, { debug: true });
    await runnerEntered.promise;

    await assert.doesNotReject(() => controller.handleCommand("gauge.stopExecution"));
    assert.equal(await execution, false);
    assert.equal(notificationCalls, 1);
    assert.equal(notificationObservations, notificationFailure === "reject" ? 1 : 0);
    assert.equal(runCancellationCalls, 1);
    controller.dispose();
  }
});

test("executor does not start work when disposal occurs in onStart", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const lifecycle = [];
  let runnerCalls = 0;
  let saveCalls = 0;
  const { commandCalls, vscode } = createFakeVscode({
    async saveAll() {
      saveCalls += 1;
      return true;
    },
  });
  let controller;
  controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
    async runner() {
      runnerCalls += 1;
      return true;
    },
  });

  const execution = controller.handleCommandWithMetadata(
    "gauge.execute.specification.all",
    {
      onCancelled() {
        lifecycle.push("cancelled");
      },
      onStart() {
        lifecycle.push("start");
        controller.dispose();
      },
    },
  );

  assert.equal(await execution, undefined);
  assert.deepEqual({
    executingTrueCalls: commandCalls.filter((call) => (
      call.command === "setContext" && call.args[1] === true
    )).length,
    lifecycle,
    runnerCalls,
    saveCalls,
  }, {
    executingTrueCalls: 0,
    lifecycle: ["start", "cancelled"],
    runnerCalls: 0,
    saveCalls: 0,
  });
});

test("executor settles work stopped in onStart", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const lifecycle = [];
  let runnerCalls = 0;
  let saveCalls = 0;
  const { commandCalls, vscode } = createFakeVscode({
    async saveAll() {
      saveCalls += 1;
      return true;
    },
  });
  let controller;
  controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
    async runner() {
      runnerCalls += 1;
      return true;
    },
  });

  let executionOutcome;
  const execution = controller.handleCommandWithMetadata(
    "gauge.execute.specification.all",
    {
      onCancelled() {
        lifecycle.push("cancelled");
      },
      onStart() {
        lifecycle.push("start");
        controller.stopExecution();
      },
    },
  );
  execution.then((value) => {
    executionOutcome = { status: "fulfilled", value };
  });
  await new Promise((resolve) => setImmediate(resolve));
  const snapshot = {
    executingTrueCalls: commandCalls.filter((call) => (
      call.command === "setContext" && call.args[1] === true
    )).length,
    executionOutcome,
    lifecycle: [...lifecycle],
    runnerCalls,
    saveCalls,
  };
  if (!executionOutcome) {
    controller.dispose();
  }

  assert.deepEqual(snapshot, {
    executingTrueCalls: 0,
    executionOutcome: { status: "fulfilled", value: undefined },
    lifecycle: ["start", "cancelled"],
    runnerCalls: 0,
    saveCalls: 0,
  });
  assert.equal(await execution, undefined);
});

test("executor settles preparing and pending executions when disposed", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const saveEntered = deferred();
  const releaseSave = deferred();
  const lifecycle = [];
  const runnerCalls = [];
  const { vscode } = createFakeVscode({
    async saveAll() {
      saveEntered.resolve();
      return releaseSave.promise;
    },
  });
  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
    async runner(command) {
      runnerCalls.push(command);
      return true;
    },
  });

  let preparingOutcome;
  const preparing = controller.handleCommandWithMetadata(
    "gauge.execute.specification.all",
    {
      onStart: () => lifecycle.push("preparing:start"),
      onSuperseded: () => lifecycle.push("preparing:superseded"),
    },
    undefined,
  );
  preparing.then((value) => {
    preparingOutcome = { status: "fulfilled", value };
  });
  await saveEntered.promise;

  let pendingOutcome;
  const pending = controller.handleCommandWithMetadata(
    "gauge.execute",
    {
      onCancelled: () => lifecycle.push("pending:cancelled"),
      onStart: () => lifecycle.push("pending:start"),
    },
    "/workspace/specs/pending.spec",
  );
  pending.then((value) => {
    pendingOutcome = { status: "fulfilled", value };
  });

  controller.dispose();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual({
    lifecycle,
    pendingOutcome,
    preparingOutcome,
    runnerCalls: runnerCalls.length,
  }, {
    lifecycle: ["preparing:start", "preparing:superseded", "pending:cancelled"],
    pendingOutcome: { status: "fulfilled", value: undefined },
    preparingOutcome: { status: "fulfilled", value: undefined },
    runnerCalls: 0,
  });

  releaseSave.resolve(true);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(runnerCalls.length, 0);
  assert.equal(await preparing, undefined);
  assert.equal(await pending, undefined);
});

test("executor cancels a multi-project execution once when disposed", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const runnerEntered = deferred();
  const lifecycle = [];
  const runnerCalls = [];
  let cancelCalls = 0;
  const { vscode } = createFakeVscode({
    workspaceFolders: [
      { uri: { fsPath: "/workspace/checkout" } },
      { uri: { fsPath: "/workspace/accounts" } },
    ],
  });
  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync(filename) {
        return filename.endsWith(".spec") || filename.endsWith("manifest.json");
      },
    },
    projectFactory: {
      get(root) {
        return { root: () => root };
      },
      getGaugeRootFromFilePath(filename) {
        return filename.startsWith("/workspace/checkout/")
          ? "/workspace/checkout"
          : "/workspace/accounts";
      },
      isGaugeProject() {
        return true;
      },
    },
    runner(command) {
      runnerCalls.push(command);
      runnerEntered.resolve();
      const run = new Promise(() => {});
      run.cancel = () => {
        cancelCalls += 1;
      };
      return run;
    },
  });

  const execution = controller.handleCommandWithMetadata(
    "gauge.execute.specification",
    {
      onCancelled: () => lifecycle.push("cancelled"),
      onStart: () => lifecycle.push("start"),
    },
    { fsPath: "/workspace/checkout/specs/checkout.spec" },
    [
      { fsPath: "/workspace/checkout/specs/checkout.spec" },
      { fsPath: "/workspace/accounts/specs/accounts.spec" },
    ],
  );
  await runnerEntered.promise;
  controller.dispose();

  assert.equal(await execution, undefined);
  assert.deepEqual({ cancelCalls, lifecycle, runnerCalls: runnerCalls.length }, {
    cancelCalls: 1,
    lifecycle: ["start", "cancelled"],
    runnerCalls: 1,
  });
});

test("executor cancels a scenario request that resolves after disposal", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const scenarioRequestEntered = deferred();
  const releaseScenarioRequest = deferred();
  const events = [];
  const lifecycle = [];
  const runnerCalls = [];
  const { commandCalls, quickPicks, statusBarItems, vscode } = createFakeVscode();
  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
    executionEventSink: (event) => events.push(event),
    readNewLastRunResultEvents: () => [],
    async runner(command) {
      runnerCalls.push(command);
      return true;
    },
    async scenariosProvider() {
      scenarioRequestEntered.resolve();
      return releaseScenarioRequest.promise;
    },
  });

  const execution = controller.handleCommandWithMetadata(
    "gauge.execute.scenario",
    {
      onCancelled: () => lifecycle.push("cancelled"),
      onStart: () => lifecycle.push("start"),
      onSuperseded: () => lifecycle.push("superseded"),
    },
    undefined,
    { testUi: true, "simple-console": false },
  );
  await scenarioRequestEntered.promise;
  let executionOutcome;
  execution.then((value) => {
    executionOutcome = { status: "fulfilled", value };
  });
  controller.dispose();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual({ executionOutcome, lifecycle }, {
    executionOutcome: { status: "fulfilled", value: undefined },
    lifecycle: ["cancelled"],
  });

  releaseScenarioRequest.resolve([{
    executionIdentifier: "/workspace/specs/example.spec:8",
    heading: "Checkout",
  }]);

  assert.equal(await execution, undefined);
  assert.deepEqual({
    events,
    executingTrueCalls: commandCalls.filter((call) => (
      call.command === "setContext" && call.args[1] === true
    )).length,
    lifecycle,
    quickPicks: quickPicks.length,
    runnerCalls: runnerCalls.length,
    statusDisposals: statusBarItems.map((item) => item.disposeCalls),
    statusShows: statusBarItems.map((item) => item.showCalls),
  }, {
    events: [],
    executingTrueCalls: 0,
    lifecycle: ["cancelled"],
    quickPicks: 0,
    runnerCalls: 0,
    statusDisposals: [1, 1],
    statusShows: [0, 0],
  });
});

test("executor settles a pending scenario selection when disposed", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const quickPickEntered = deferred();
  const releaseQuickPick = deferred();
  const lifecycle = [];
  const runnerCalls = [];
  const { vscode } = createFakeVscode({
    showQuickPick() {
      quickPickEntered.resolve();
      return releaseQuickPick.promise;
    },
  });
  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
    async runner(command) {
      runnerCalls.push(command);
      return true;
    },
    async scenariosProvider() {
      return [{
        executionIdentifier: "/workspace/specs/example.spec:8",
        heading: "Checkout",
      }];
    },
  });

  let executionOutcome;
  const execution = controller.handleCommandWithMetadata(
    "gauge.execute.scenarios",
    {
      onCancelled: () => lifecycle.push("cancelled"),
      onStart: () => lifecycle.push("start"),
    },
  );
  execution.then((value) => {
    executionOutcome = { status: "fulfilled", value };
  });
  await quickPickEntered.promise;
  controller.dispose();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual({ executionOutcome, lifecycle, runnerCalls: runnerCalls.length }, {
    executionOutcome: { status: "fulfilled", value: undefined },
    lifecycle: ["cancelled"],
    runnerCalls: 0,
  });

  releaseQuickPick.resolve(undefined);
  assert.equal(await execution, undefined);
  assert.equal(runnerCalls.length, 0);
});

test("executor settles a pending project selection when disposed", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const quickPickEntered = deferred();
  const releaseQuickPick = deferred();
  const lifecycle = [];
  const runnerCalls = [];
  const { vscode } = createFakeVscode({
    workspaceFolders: [
      { uri: { fsPath: "/workspace/checkout" } },
      { uri: { fsPath: "/workspace/accounts" } },
    ],
    showQuickPick() {
      quickPickEntered.resolve();
      return releaseQuickPick.promise;
    },
  });
  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
    async runner(command) {
      runnerCalls.push(command);
      return true;
    },
  });

  let executionOutcome;
  const execution = controller.handleCommandWithMetadata(
    "gauge.execute.failed",
    {
      onCancelled: () => lifecycle.push("cancelled"),
      onStart: () => lifecycle.push("start"),
    },
  );
  execution.then((value) => {
    executionOutcome = { status: "fulfilled", value };
  });
  await quickPickEntered.promise;
  controller.dispose();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual({ executionOutcome, lifecycle, runnerCalls: runnerCalls.length }, {
    executionOutcome: { status: "fulfilled", value: undefined },
    lifecycle: ["cancelled"],
    runnerCalls: 0,
  });

  releaseQuickPick.resolve(undefined);
  assert.equal(await execution, undefined);
  assert.equal(runnerCalls.length, 0);
});

test("executor does not supersede active work after a Test UI request is cancelled", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const activeRunEntered = deferred();
  const activeRunResponse = deferred();
  const quickPickEntered = deferred();
  const releaseQuickPick = deferred();
  const lifecycle = [];
  const runnerCalls = [];
  let activeCancelCalls = 0;
  let requestCancelled = false;
  const { vscode } = createFakeVscode({
    workspaceFolders: [
      { uri: { fsPath: "/workspace/checkout" } },
      { uri: { fsPath: "/workspace/accounts" } },
    ],
    showQuickPick() {
      quickPickEntered.resolve();
      return releaseQuickPick.promise;
    },
  });
  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
    projectFactory: {
      get(root) {
        return { root: () => root };
      },
      getGaugeRootFromFilePath(file) {
        return file.startsWith("/workspace/checkout/")
          ? "/workspace/checkout"
          : "/workspace/accounts";
      },
      isGaugeProject() {
        return true;
      },
    },
    runner(command) {
      runnerCalls.push(command);
      if (runnerCalls.length > 1) {
        return Promise.resolve(true);
      }
      activeRunEntered.resolve();
      const run = activeRunResponse.promise;
      run.cancel = () => {
        activeCancelCalls += 1;
        activeRunResponse.resolve(false);
      };
      return run;
    },
  });

  const activeExecution = controller.handleCommand(
    "gauge.execute",
    "/workspace/checkout/specs/checkout.spec",
  );
  await activeRunEntered.promise;
  const cancelledExecution = controller.handleCommandWithMetadata(
    "gauge.execute.failed",
    {
      isCancellationRequested: () => requestCancelled,
      onCancelled: () => lifecycle.push("cancelled"),
      onStart: () => lifecycle.push("start"),
      onSuperseded: () => lifecycle.push("superseded"),
    },
  );
  await quickPickEntered.promise;
  requestCancelled = true;
  releaseQuickPick.resolve({ description: "/workspace/accounts" });
  const cancelledResult = await cancelledExecution;
  const stateBeforeCleanup = {
    activeCancelCalls,
    cancelledResult,
    lifecycle: [...lifecycle],
    runnerCalls: runnerCalls.length,
  };
  if (activeCancelCalls === 0) {
    activeRunResponse.resolve(true);
  }
  await activeExecution;

  assert.deepEqual(stateBeforeCleanup, {
    activeCancelCalls: 0,
    cancelledResult: undefined,
    lifecycle: ["cancelled"],
    runnerCalls: 1,
  });
});

test("executor does not start a queued Test UI request cancelled before drain", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const activeRunEntered = deferred();
  const activeRunCancelled = deferred();
  const activeRunResponse = deferred();
  const lifecycle = [];
  const runnerCalls = [];
  let activeCancelCalls = 0;
  let requestCancelled = false;
  const { vscode } = createFakeVscode();
  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
    projectFactory: {
      get(root) {
        return { root: () => root };
      },
      getGaugeRootFromFilePath(file) {
        return file.startsWith("/workspace/checkout/")
          ? "/workspace/checkout"
          : "/workspace/accounts";
      },
      isGaugeProject() {
        return true;
      },
    },
    runner(command) {
      runnerCalls.push(command);
      if (runnerCalls.length > 1) {
        return Promise.resolve(true);
      }
      activeRunEntered.resolve();
      const run = activeRunResponse.promise;
      run.cancel = () => {
        activeCancelCalls += 1;
        activeRunCancelled.resolve();
      };
      return run;
    },
  });

  const activeExecution = controller.handleCommand(
    "gauge.execute",
    "/workspace/checkout/specs/checkout.spec",
  );
  await activeRunEntered.promise;
  const cancelledExecution = controller.handleCommandWithMetadata(
    "gauge.execute",
    {
      isCancellationRequested: () => requestCancelled,
      onCancelled: () => lifecycle.push("cancelled"),
      onStart: () => lifecycle.push("start"),
      onSuperseded: () => lifecycle.push("superseded"),
    },
    "/workspace/accounts/specs/accounts.spec",
  );
  await activeRunCancelled.promise;
  requestCancelled = true;
  activeRunResponse.resolve(false);

  assert.equal(await cancelledExecution, undefined);
  assert.equal(await activeExecution, false);
  assert.deepEqual({ activeCancelCalls, lifecycle, runnerCalls: runnerCalls.length }, {
    activeCancelCalls: 1,
    lifecycle: ["cancelled"],
    runnerCalls: 1,
  });
});

test("executor cancels a project selection resolved in the disposal turn", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const quickPickEntered = deferred();
  const releaseQuickPick = deferred();
  const lifecycle = [];
  const { vscode } = createFakeVscode({
    workspaceFolders: [
      { uri: { fsPath: "/workspace/checkout" } },
      { uri: { fsPath: "/workspace/accounts" } },
    ],
    showQuickPick() {
      quickPickEntered.resolve();
      return releaseQuickPick.promise;
    },
  });
  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
  });

  const execution = controller.handleCommandWithMetadata(
    "gauge.execute.failed",
    {
      onCancelled: () => lifecycle.push("cancelled"),
      onStart: () => lifecycle.push("start"),
    },
  );
  await quickPickEntered.promise;
  releaseQuickPick.resolve(undefined);
  controller.dispose();

  assert.equal(await execution, undefined);
  assert.deepEqual(lifecycle, ["cancelled"]);
});

test("executor suppresses a project selection rejected in the disposal turn", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const lifecycle = [];
  let controller;
  const { vscode } = createFakeVscode({
    workspaceFolders: [
      { uri: { fsPath: "/workspace/checkout" } },
      { uri: { fsPath: "/workspace/accounts" } },
    ],
    showQuickPick() {
      return {
        then(_resolve, reject) {
          reject(new Error("disposed project selection failed"));
          controller.dispose();
        },
      };
    },
  });
  controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
  });

  const execution = controller.handleCommandWithMetadata(
    "gauge.execute.failed",
    {
      onCancelled: () => lifecycle.push("cancelled"),
      onStart: () => lifecycle.push("start"),
    },
  );

  assert.equal(await execution, undefined);
  assert.deepEqual(lifecycle, ["cancelled"]);

  const { vscode: liveVscode } = createFakeVscode({
    workspaceFolders: [
      { uri: { fsPath: "/workspace/checkout" } },
      { uri: { fsPath: "/workspace/accounts" } },
    ],
    showQuickPick() {
      return Promise.reject(new Error("live project selection failed"));
    },
  });
  const liveController = createGaugeExecutionController({
    vscode: liveVscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
  });
  await assert.rejects(
    liveController.handleCommand("gauge.execute.failed"),
    /live project selection failed/,
  );
  liveController.dispose();
});

test("executor suppresses scenario lookup errors after disposal", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const scenarioRequestEntered = deferred();
  let rejectScenarioRequest;
  const scenarioRequest = new Promise((_resolve, reject) => {
    rejectScenarioRequest = reject;
  });
  const { errors, vscode } = createFakeVscode();
  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
    async scenariosProvider() {
      scenarioRequestEntered.resolve();
      return scenarioRequest;
    },
  });

  const execution = controller.handleCommand("gauge.execute.scenario");
  await scenarioRequestEntered.promise;
  controller.dispose();
  rejectScenarioRequest(new Error("disposed scenario lookup failed"));

  assert.equal(await execution, undefined);
  assert.deepEqual(errors, []);
});

test("executor suppresses scenario lookup errors after Test UI cancellation", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const scenarioRequestEntered = deferred();
  let rejectScenarioRequest;
  const scenarioRequest = new Promise((_resolve, reject) => {
    rejectScenarioRequest = reject;
  });
  const lifecycle = [];
  let requestCancelled = false;
  const { errors, vscode } = createFakeVscode();
  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
    async scenariosProvider() {
      scenarioRequestEntered.resolve();
      return scenarioRequest;
    },
  });

  const execution = controller.handleCommandWithMetadata(
    "gauge.execute.scenario",
    {
      isCancellationRequested: () => requestCancelled,
      onCancelled: () => lifecycle.push("cancelled"),
      onStart: () => lifecycle.push("start"),
    },
  );
  await scenarioRequestEntered.promise;
  requestCancelled = true;
  rejectScenarioRequest(new Error("cancelled scenario lookup failed"));

  assert.equal(await execution, undefined);
  assert.deepEqual(errors, []);
  assert.deepEqual(lifecycle, ["cancelled"]);
});

test("executor disposes the real scenario provider and cancels its pending request exactly once", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const { createGaugeScenariosProvider } = require("../../src/execution/scenarioProvider");
  const requestEntered = deferred();
  const releaseRequest = deferred();
  const runnerCalls = [];
  const { errors, quickPicks, vscode } = createFakeVscode();
  const sources = installCancellationSources(vscode);
  const provider = trackDisposableProvider(createGaugeScenariosProvider({
    get() {
      return {
        client: {
          start() {
            return Promise.resolve(undefined);
          },
          sendRequest() {
            requestEntered.resolve();
            return releaseRequest.promise;
          },
        },
      };
    },
  }, { vscode }));
  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
    ownsScenariosProvider: true,
    scenariosProvider: provider,
    async runner(command) {
      runnerCalls.push(command);
      return true;
    },
  });

  const execution = controller.handleCommand("gauge.execute.scenarios");
  await requestEntered.promise;
  controller.dispose();
  controller.dispose();
  assert.equal(await execution, undefined);

  let providerOutcome = { status: "pending" };
  provider.state.operation.then(
    (value) => {
      providerOutcome = { status: "fulfilled", value };
    },
    (error) => {
      providerOutcome = { error, status: "rejected" };
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  const providerOutcomeBeforeRelease = providerOutcome;

  releaseRequest.resolve([
    {
      heading: "Late scenario",
      executionIdentifier: "/workspace/specs/example.spec:8",
    },
  ]);
  assert.equal(await provider.state.operation, undefined);

  assert.deepEqual({
    disposeCalls: provider.state.disposeCalls,
    errors,
    providerOutcomeBeforeRelease,
    quickPicks,
    runnerCalls: runnerCalls.length,
    sources: sources.map((source) => ({
      cancelCalls: source.cancelCalls,
      disposeCalls: source.disposeCalls,
      isCancellationRequested: source.token.isCancellationRequested,
    })),
  }, {
    disposeCalls: 1,
    errors: [],
    providerOutcomeBeforeRelease: { status: "fulfilled", value: undefined },
    quickPicks: [],
    runnerCalls: 0,
    sources: [{
      cancelCalls: 1,
      disposeCalls: 1,
      isCancellationRequested: true,
    }],
  });
});

test("executor suppresses pending status and output after disposal", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const statusRequestEntered = deferred();
  const releaseStatusRequest = deferred();
  const events = [];
  const { statusBarItems, vscode } = createFakeVscode();
  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
    executionEventSink: (event) => events.push(event),
    async executionStatusProvider() {
      statusRequestEntered.resolve();
      return releaseStatusRequest.promise;
    },
    async runner() {
      return true;
    },
  });

  const execution = controller.handleCommand("gauge.execute.specification.all");
  await statusRequestEntered.promise;
  controller.dispose();
  controller.processOutputLine(`${JSON.stringify({
    type: "specStart",
    id: "/workspace/specs/example.spec",
    name: "Checkout",
    filename: "/workspace/specs/example.spec",
    line: 1,
  })}\n`);
  controller.setReportPath("/workspace/reports/html-report/index.html");
  releaseStatusRequest.resolve({
    sceExecuted: 1,
    sceFailed: 0,
    scePassed: 1,
    sceSkipped: 0,
    specsExecuted: 1,
    specsFailed: 0,
    specsPassed: 1,
    specsSkipped: 0,
  });

  assert.equal(await execution, undefined);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual({
    events,
    reportPath: controller.getReportPath(),
    statusColor: statusBarItems[1].color,
    statusDisposals: statusBarItems.map((item) => item.disposeCalls),
    statusShows: statusBarItems.map((item) => item.showCalls),
    statusText: statusBarItems[1].text,
  }, {
    events: [],
    reportPath: undefined,
    statusColor: undefined,
    statusDisposals: [1, 1],
    statusShows: [1, 0],
    statusText: undefined,
  });
});

test("executor disposes the real execution status provider and cancels its pending request exactly once", async () => {
  const {
    createGaugeExecutionController,
    createGaugeExecutionStatusProvider,
  } = require("../../src/execution/executor");
  const requestEntered = deferred();
  const releaseRequest = deferred();
  const { statusBarItems, vscode } = createFakeVscode();
  const sources = installCancellationSources(vscode);
  const provider = trackDisposableProvider(createGaugeExecutionStatusProvider({
    get(projectRoot) {
      assert.equal(projectRoot, "/workspace");
      return {
        client: {
          sendRequest() {
            requestEntered.resolve();
            return releaseRequest.promise;
          },
        },
      };
    },
  }, { vscode }));
  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
    executionStatusProvider: provider,
    ownsExecutionStatusProvider: true,
    async runner() {
      return true;
    },
  });

  const execution = controller.handleCommand("gauge.execute.specification.all");
  await requestEntered.promise;
  controller.dispose();
  controller.dispose();
  assert.equal(await execution, undefined);

  let providerOutcome = { status: "pending" };
  provider.state.operation.then(
    (value) => {
      providerOutcome = { status: "fulfilled", value };
    },
    (error) => {
      providerOutcome = { error, status: "rejected" };
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  const providerOutcomeBeforeRelease = providerOutcome;

  releaseRequest.resolve({
    sceExecuted: 1,
    sceFailed: 0,
    scePassed: 1,
    sceSkipped: 0,
    specsExecuted: 1,
    specsFailed: 0,
    specsPassed: 1,
    specsSkipped: 0,
  });
  assert.equal(await provider.state.operation, undefined);

  assert.deepEqual({
    disposeCalls: provider.state.disposeCalls,
    providerOutcomeBeforeRelease,
    sources: sources.map((source) => ({
      cancelCalls: source.cancelCalls,
      disposeCalls: source.disposeCalls,
      isCancellationRequested: source.token.isCancellationRequested,
    })),
    statusShows: statusBarItems[1].showCalls,
  }, {
    disposeCalls: 1,
    providerOutcomeBeforeRelease: { status: "fulfilled", value: undefined },
    sources: [{
      cancelCalls: 1,
      disposeCalls: 1,
      isCancellationRequested: true,
    }],
    statusShows: 0,
  });
});

test("Gauge execution status provider releases request sources on live success and failure", async () => {
  const { createGaugeExecutionStatusProvider } = require("../../src/execution/executor");
  const response = { scePassed: 1 };
  const requestError = new Error("status request failed");

  for (const outcome of ["success", "failure"]) {
    const { vscode } = createFakeVscode();
    const sources = installCancellationSources(vscode);
    const tokens = [];
    const provider = createGaugeExecutionStatusProvider({
      get() {
        return {
          client: {
            sendRequest(_method, _params, token) {
              tokens.push(token);
              return outcome === "success"
                ? Promise.resolve(response)
                : Promise.reject(requestError);
            },
          },
        };
      },
    }, { vscode });

    const invocation = provider("/workspace");
    if (outcome === "success") {
      assert.equal(await invocation, response);
    } else {
      await assert.rejects(invocation, (error) => error === requestError);
    }

    assert.equal(tokens[0], sources[0].token);
    assert.deepEqual(sources.map((source) => ({
      cancelCalls: source.cancelCalls,
      disposeCalls: source.disposeCalls,
    })), [{ cancelCalls: 0, disposeCalls: 1 }]);
  }
});

test("Gauge execution status provider handles synchronous disposal and concurrent requests", async () => {
  const { createGaugeExecutionStatusProvider } = require("../../src/execution/executor");
  const synchronousVscode = createFakeVscode().vscode;
  const synchronousSources = installCancellationSources(synchronousVscode);
  const synchronousError = new Error("synchronous status failure");
  let synchronousProvider;
  let synchronousMapCalls = 0;
  let synchronousRequestCalls = 0;
  synchronousProvider = createGaugeExecutionStatusProvider({
    get() {
      synchronousMapCalls += 1;
      return {
        client: {
          sendRequest() {
            synchronousRequestCalls += 1;
            synchronousProvider.dispose();
            synchronousSources[0].cancel = function cancelWithFailure() {
              this.cancelCalls += 1;
              throw new Error("status cancellation failed");
            };
            throw synchronousError;
          },
        },
      };
    },
  }, { vscode: synchronousVscode });

  assert.equal(await synchronousProvider("/workspace"), undefined);
  assert.deepEqual(synchronousSources.map((source) => ({
    cancelCalls: source.cancelCalls,
    disposeCalls: source.disposeCalls,
  })), [{ cancelCalls: 1, disposeCalls: 1 }]);
  assert.equal(await synchronousProvider("/workspace"), undefined);
  assert.equal(synchronousMapCalls, 1);
  assert.equal(synchronousRequestCalls, 1);

  const concurrentVscode = createFakeVscode().vscode;
  const concurrentSources = installCancellationSources(concurrentVscode);
  const requests = [deferred(), deferred()];
  let requestIndex = 0;
  const concurrentProvider = createGaugeExecutionStatusProvider({
    get() {
      return {
        client: {
          sendRequest() {
            const request = requests[requestIndex];
            requestIndex += 1;
            return request.promise;
          },
        },
      };
    },
  }, { vscode: concurrentVscode });

  const first = concurrentProvider("/workspace/first");
  const second = concurrentProvider("/workspace/second");
  concurrentProvider.dispose();
  concurrentProvider.dispose();

  assert.deepEqual(await Promise.all([first, second]), [undefined, undefined]);
  requests[0].resolve({ scePassed: 1 });
  requests[1].resolve({ scePassed: 2 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(concurrentSources.map((source) => ({
    cancelCalls: source.cancelCalls,
    disposeCalls: source.disposeCalls,
  })), [
    { cancelCalls: 1, disposeCalls: 1 },
    { cancelCalls: 1, disposeCalls: 1 },
  ]);
});

test("executor owns only request providers marked as controller-owned", () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const { vscode } = createFakeVscode();
  let borrowedDisposeCalls = 0;
  const borrowedProvider = () => Promise.resolve(undefined);
  borrowedProvider.dispose = () => {
    borrowedDisposeCalls += 1;
  };
  const borrowedController = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
    scenariosProvider: borrowedProvider,
    executionStatusProvider: borrowedProvider,
  });
  borrowedController.dispose();
  borrowedController.dispose();

  let ownedDisposeCalls = 0;
  const ownedProvider = () => Promise.resolve(undefined);
  ownedProvider.dispose = () => {
    ownedDisposeCalls += 1;
  };
  const ownedController = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
    scenariosProvider: ownedProvider,
    executionStatusProvider: ownedProvider,
    ownsScenariosProvider: true,
    ownsExecutionStatusProvider: true,
  });
  ownedController.dispose();
  ownedController.dispose();

  assert.equal(borrowedDisposeCalls, 0);
  assert.equal(ownedDisposeCalls, 1);

  let firstOwnedDisposeCalls = 0;
  const firstOwnedProvider = () => Promise.resolve(undefined);
  firstOwnedProvider.dispose = () => {
    firstOwnedDisposeCalls += 1;
    throw new Error("first provider disposal failed");
  };
  let secondOwnedDisposeCalls = 0;
  const secondOwnedProvider = () => Promise.resolve(undefined);
  secondOwnedProvider.dispose = () => {
    secondOwnedDisposeCalls += 1;
  };
  const isolatedController = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
    scenariosProvider: firstOwnedProvider,
    executionStatusProvider: secondOwnedProvider,
    ownsScenariosProvider: true,
    ownsExecutionStatusProvider: true,
  });
  assert.doesNotThrow(() => isolatedController.dispose());
  isolatedController.dispose();
  assert.equal(firstOwnedDisposeCalls, 1);
  assert.equal(secondOwnedDisposeCalls, 1);
});

test("executor settles a pending report open when disposed", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const openEntered = deferred();
  let rejectOpen;
  const openResult = new Promise((_resolve, reject) => {
    rejectOpen = reject;
  });
  const { errors, vscode } = createFakeVscode();
  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
    opener() {
      openEntered.resolve();
      return openResult;
    },
  });

  let reportOutcome;
  const report = controller.openReport();
  report.then((value) => {
    reportOutcome = { status: "fulfilled", value };
  });
  await openEntered.promise;
  controller.dispose();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual({ errors, reportOutcome }, {
    errors: [],
    reportOutcome: { status: "fulfilled", value: undefined },
  });

  rejectOpen(new Error("disposed report open failed"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(errors, []);
  assert.equal(await report, undefined);
});

test("executor normalizes a report opened in the disposal turn", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const openEntered = deferred();
  const releaseOpen = deferred();
  const { vscode } = createFakeVscode();
  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
    opener() {
      openEntered.resolve();
      return releaseOpen.promise;
    },
  });

  const report = controller.openReport();
  await openEntered.promise;
  releaseOpen.resolve(true);
  controller.dispose();

  assert.equal(await report, undefined);
});

test("executor suppresses a report failure in the disposal turn", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const openEntered = deferred();
  let rejectOpen;
  const openResult = new Promise((_resolve, reject) => {
    rejectOpen = reject;
  });
  const { errors, vscode } = createFakeVscode();
  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: { existsSync: () => false },
    opener() {
      openEntered.resolve();
      return openResult;
    },
  });

  const report = controller.openReport();
  await openEntered.promise;
  rejectOpen(new Error("disposed report open failed"));
  controller.dispose();

  assert.equal(await report, undefined);
  assert.deepEqual(errors, []);
});

test("executor sets the executing context while a run is active", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const { commandCalls, vscode } = createFakeVscode();

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    async runner(command) {
      calls.push(command);
      assert.deepEqual(commandCalls, [
        { command: "setContext", args: ["gauge:executing", true] },
      ]);
      return true;
    },
  });

  await controller.handleCommand("gauge.execute.specification.all");

  assert.equal(calls.length, 1);
  assert.deepEqual(commandCalls, [
    { command: "setContext", args: ["gauge:executing", true] },
    { command: "setContext", args: ["gauge:executing", false] },
  ]);
});

test("executor reports stop failures without rejecting the command", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  let finish;
  const { errors, vscode } = createFakeVscode();

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    runner() {
      const run = new Promise((resolve) => {
        finish = resolve;
      });
      run.cancel = () => {
        throw new Error("kill failed");
      };
      return run;
    },
  });

  const run = controller.handleCommand("gauge.execute.specification.all");
  await Promise.resolve();

  try {
    await assert.doesNotReject(() => controller.handleCommand("gauge.stopExecution"));
  } finally {
    finish(false);
    await run;
  }

  assert.deepEqual(errors, ["Failed to Stop Run: kill failed"]);
});

test("executor treats debugger attach cancellation as a non-user abort", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const cancelCalls = [];
  let finish;
  const { errors, vscode } = createFakeVscode();

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    runner() {
      const run = new Promise((resolve) => {
        finish = resolve;
      });
      run.cancel = (aborted) => {
        cancelCalls.push(aborted);
        finish(false);
      };
      return run;
    },
  });

  const run = controller.handleCommand("gauge.execute.specification.all");
  await Promise.resolve();
  controller.processOutputLine("No debugger attached");

  assert.equal(await run, false);
  assert.deepEqual(errors, ["No debugger attached. Stopping the execution"]);
  assert.deepEqual(cancelCalls, [false]);
});

test("executor routes Gauge machine-readable output to the execution event sink", () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const events = [];
  const { vscode } = createFakeVscode();

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    executionEventSink(event) {
      events.push(event);
    },
    runner() {
      return Promise.resolve(true);
    },
  });

  controller.processOutputLine(`${JSON.stringify({
    type: "specStart",
    id: "/workspace/specs/example.spec",
    name: "Checkout",
    filename: "/workspace/specs/example.spec",
    line: 1,
  })}\n`);

  assert.deepEqual(events, [
    {
      type: "lineBreak",
    },
    {
      type: "suiteStarted",
      id: "/workspace/specs/example.spec",
      parentId: "suite",
      name: "Checkout",
      location: "gauge:///workspace/specs/example.spec:1",
    },
  ]);
});

test("executor reports when the Gauge process starts", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const child = new EventEmitter();
  child.pid = 2468;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  const events = [];
  const { vscode } = createFakeVscode();
  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    executionEventSink(event) {
      events.push(event);
    },
    spawn() {
      queueMicrotask(() => child.emit("close", 0));
      return child;
    },
  });

  await controller.handleCommand(
    "gauge.execute.specification.all",
    undefined,
    { testUi: true },
  );

  assert.equal(events[0].type, "processStarted");
});

test("executor stores html report paths from machine-readable output", () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const { vscode } = createFakeVscode();

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    runner() {
      return Promise.resolve(true);
    },
  });

  controller.processOutputLine(`${JSON.stringify({
    type: "out",
    message: "Successfully generated html-report to => /workspace/reports/html-report/index.html",
  })}\n`);

  assert.equal(controller.getReportPath(), "/workspace/reports/html-report/index.html");
});

test("Test UI run emits synthetic failed event when Gauge exits without a saved result", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const events = [];
  const { vscode } = createFakeVscode();

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    executionEventSink(event) {
      events.push(event);
    },
    async runner() {
      return false;
    },
  });

  await controller.handleCommand("gauge.execute.specification.all", undefined, {
    "simple-console": false,
    testUi: true,
  });

  assert.deepEqual(events, [
    {
      type: "testStarted",
      id: "/workspace::result:failed",
      parentId: "suite",
      name: "Failed",
      resultOnly: true,
    },
    {
      type: "testFailed",
      id: "/workspace::result:failed",
      parentId: "suite",
      name: "Failed",
      message: " ",
      resultOnly: true,
    },
    {
      type: "testFinished",
      id: "/workspace::result:failed",
      parentId: "suite",
      name: "Failed",
      resultOnly: true,
    },
  ]);
});

test("Test UI run publishes leaf events from the saved Gauge result", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const events = [];
  const reads = [];
  const { vscode } = createFakeVscode();
  const resultEvents = [
    {
      type: "testFinished",
      id: "/workspace/specs/example.spec:3",
      parentId: "/workspace/specs/example.spec",
      name: "Passing",
      duration: 42,
    },
  ];

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    executionEventSink(event) {
      events.push(event);
    },
    lastRunResultStamp(projectRoot) {
      assert.equal(projectRoot, "/workspace");
      return "before";
    },
    readNewLastRunResultEvents(projectRoot, stamp) {
      reads.push([projectRoot, stamp]);
      return resultEvents;
    },
    async runner(command) {
      assert.equal(command.forwardOutput, true);
      assert.equal(command.saveExecutionResult, true);
      return true;
    },
  });

  await controller.handleCommand("gauge.execute.specification.all", undefined, {
    "simple-console": false,
    testUi: true,
  });

  assert.deepEqual(reads, [["/workspace", "before"]]);
  assert.deepEqual(events, resultEvents);
});

test("executor shows the last execution status in the status bar", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const statusRequests = [];
  const { statusBarItems, vscode } = createFakeVscode();

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    executionStatusProvider(projectRoot) {
      statusRequests.push(projectRoot);
      return Promise.resolve({
        sceExecuted: 6,
        sceFailed: 1,
        scePassed: 2,
        sceSkipped: 3,
        specsExecuted: 2,
        specsFailed: 1,
        specsPassed: 1,
        specsSkipped: 0,
      });
    },
    runner() {
      return Promise.resolve(true);
    },
  });

  await controller.handleCommand("gauge.execute.specification.all");

  const executionStatus = statusBarItems[1];
  assert.deepEqual(statusRequests, ["/workspace"]);
  assert.equal(executionStatus.command, "gauge.report.html");
  assert.equal(executionStatus.color, "#E73E48");
  assert.equal(executionStatus.text, "$(check) 2  $(x) 1  $(issue-opened) 3");
  assert.equal(
    executionStatus.tooltip,
    "Specs : 2 Executed, 1 Passed, 1 Failed, 0 Skipped\n"
      + "Scenarios : 6 Executed, 2 Passed, 1 Failed, 3 Skipped",
  );
  assert.equal(executionStatus.showCalls, 1);
});

test("executor shows the last execution status after failed runs", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const statusRequests = [];
  const { statusBarItems, vscode } = createFakeVscode();

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    executionStatusProvider(projectRoot) {
      statusRequests.push(projectRoot);
      return Promise.resolve({
        sceExecuted: 1,
        sceFailed: 1,
        scePassed: 0,
        sceSkipped: 0,
        specsExecuted: 1,
        specsFailed: 1,
        specsPassed: 0,
        specsSkipped: 0,
      });
    },
    runner() {
      return Promise.resolve(false);
    },
  });

  assert.equal(await controller.handleCommand("gauge.execute.specification.all"), false);

  const executionStatus = statusBarItems[1];
  assert.deepEqual(statusRequests, ["/workspace"]);
  assert.equal(executionStatus.color, "#E73E48");
  assert.equal(executionStatus.text, "$(check) 0  $(x) 1  $(issue-opened) 0");
  assert.equal(executionStatus.showCalls, 1);
});

test("execute scenario at cursor runs the provider scenario and ignores launch filters", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const scenarioRequests = [];
  const { vscode } = createFakeVscode({
    launchConfigurations: [
      {
        type: "gauge",
        request: "test",
        name: "Gauge",
        tags: "ignored",
        scenario: ["ignored"],
        "retry-only": "ignored",
      },
    ],
    activeTextEditor: {
      selection: { active: { line: 8, character: 0 } },
      document: {
        fileName: "/workspace/specs/example.spec",
        uri: { fsPath: "/workspace/specs/example.spec" },
      },
    },
  });

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/build.gradle.kts";
      },
    },
    async scenariosProvider(request) {
      scenarioRequests.push(request);
      return {
        heading: "Checkout order",
        executionIdentifier: "/workspace/specs/example.spec:8",
      };
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  await controller.handleCommand("gauge.execute.scenario");

  assert.deepEqual(scenarioRequests, [
    {
      projectRoot: "/workspace",
      spec: "/workspace/specs/example.spec",
      position: { line: 8, character: 0 },
      atCursor: true,
    },
  ]);
  assert.deepEqual(calls, [
    {
      command: "gradle",
      args: [
        "clean",
        "gauge",
        "-PadditionalFlags=--hide-suggestion --simple-console",
        "-PspecsDir=specs/example.spec:8",
      ],
      cwd: "/workspace",
      status: "/workspace/specs/example.spec:8",
    },
  ]);
});

test("execute scenario at cursor accepts command flags for Test UI events", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const { vscode } = createFakeVscode({
    activeTextEditor: {
      selection: { active: { line: 8, character: 0 } },
      document: {
        fileName: "/workspace/specs/example.spec",
        uri: { fsPath: "/workspace/specs/example.spec" },
      },
    },
  });

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    async scenariosProvider() {
      return {
        heading: "Checkout order",
        executionIdentifier: "/workspace/specs/example.spec:8",
      };
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  await controller.handleCommand("gauge.execute.scenario", undefined, {
    "hide-suggestion": true,
    "simple-console": false,
    testUi: true,
  });

  assert.deepEqual(calls, [
    {
      command: "gauge",
      args: [
        "run",
        "--hide-suggestion",
        "/workspace/specs/example.spec:8",
      ],
      cwd: "/workspace",
      forwardOutput: true,
      saveExecutionResult: true,
      status: "/workspace/specs/example.spec:8",
    },
  ]);
});

test("execute Maven scenario compiles the project and runs Gauge directly", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const classpathCalls = [];
  const runCalls = [];
  const gaugeCommand = {
    command: "gauge",
    argsForSpawnType(args) {
      return args;
    },
  };
  const mavenCommand = {
    command: "mvn",
    argsForSpawnType(args) {
      return args;
    },
  };
  const { vscode } = createFakeVscode({
    activeTextEditor: {
      selection: { active: { line: 2, character: 0 } },
      document: {
        fileName: "/workspace/specs/example.spec",
        uri: { fsPath: "/workspace/specs/example.spec" },
      },
    },
  });

  const controller = createGaugeExecutionController({
    vscode,
    cli: {
      gaugeCommand() {
        return gaugeCommand;
      },
      mavenCommand() {
        return mavenCommand;
      },
    },
    pathModule: path.posix,
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/manifest.json"
          || filename === "/workspace/pom.xml";
      },
      readFileSync(filename) {
        assert.equal(filename, "/workspace/manifest.json");
        return Buffer.from(JSON.stringify({ Language: "kotlin" }));
      },
    },
    execSync(command, options) {
      classpathCalls.push({ command, options });
      return Buffer.from("/workspace/target/test-classes\n");
    },
    async scenariosProvider() {
      return {
        heading: "Checkout order",
        executionIdentifier: "/workspace/specs/example.spec:3",
      };
    },
    async runner(command) {
      runCalls.push(command);
      return true;
    },
  });

  const result = await controller.handleCommand("gauge.execute.scenario");

  assert.equal(result, true);
  assert.deepEqual(classpathCalls, [
    {
      command: "mvn -q test-compile",
      options: { cwd: "/workspace" },
    },
    {
      command: "mvn -q gauge:classpath",
      options: { cwd: "/workspace" },
    },
  ]);
  assert.deepEqual(runCalls, [
    {
      command: "gauge",
      tool: gaugeCommand,
      args: [
        "run",
        "--hide-suggestion",
        "--simple-console",
        "/workspace/specs/example.spec:3",
      ],
      cwd: "/workspace",
      env: {
        ...process.env,
        gauge_custom_classpath: "/workspace/target/test-classes",
      },
      status: "/workspace/specs/example.spec:3",
    },
  ]);
});

test("execute Kotlin Gradle scenario prepares classes and runs Gauge directly", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const classpathCalls = [];
  const runCalls = [];
  const gaugeCommand = {
    command: "/tools/gauge",
    argsForSpawnType(args) {
      return args;
    },
  };
  const gradleCommand = {
    command: "./gradlew",
    argsForSpawnType(args) {
      return args;
    },
  };
  const { vscode } = createFakeVscode({
    activeTextEditor: {
      selection: { active: { line: 2, character: 0 } },
      document: {
        fileName: "/workspace/specs/example.spec",
        uri: { fsPath: "/workspace/specs/example.spec" },
      },
    },
  });

  const controller = createGaugeExecutionController({
    vscode,
    cli: {
      gaugeCommand() {
        return gaugeCommand;
      },
      gradleCommand() {
        return gradleCommand;
      },
    },
    pathModule: path.posix,
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/manifest.json"
          || filename === "/workspace/build.gradle.kts"
          || filename === "/workspace/gradlew";
      },
      readFileSync(filename) {
        assert.equal(filename, "/workspace/manifest.json");
        return Buffer.from(JSON.stringify({ Language: "kotlin" }));
      },
    },
    execSync(command, options) {
      classpathCalls.push({ command, options });
      return Buffer.from("/workspace/build/classes/kotlin/test\n");
    },
    async scenariosProvider() {
      return {
        heading: "Checkout order",
        executionIdentifier: "/workspace/specs/example.spec:3",
      };
    },
    async runner(command) {
      runCalls.push(command);
      return true;
    },
  });

  const result = await controller.handleCommand("gauge.execute.scenario");

  assert.equal(result, true);
  assert.deepEqual(classpathCalls, [
    {
      command: "./gradlew -q testClasses",
      options: { cwd: "/workspace" },
    },
    {
      command: "./gradlew -q classpath --rerun",
      options: { cwd: "/workspace" },
    },
  ]);
  assert.deepEqual(runCalls, [
    {
      command: "/tools/gauge",
      tool: gaugeCommand,
      args: [
        "run",
        "--hide-suggestion",
        "--simple-console",
        "/workspace/specs/example.spec:3",
      ],
      cwd: "/workspace",
      env: {
        ...process.env,
        gauge_custom_classpath: "/workspace/build/classes/kotlin/test",
      },
      status: "/workspace/specs/example.spec:3",
    },
  ]);
});

test("execute Maven scenario stops when project compilation fails", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const runCalls = [];
  const { errors, vscode } = createFakeVscode();
  const controller = createGaugeExecutionController({
    vscode,
    cli: {
      gaugeCommand() {
        return { command: "gauge" };
      },
      mavenCommand() {
        return { command: "mvn" };
      },
    },
    pathModule: path.posix,
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/manifest.json"
          || filename === "/workspace/pom.xml";
      },
      readFileSync(filename) {
        assert.equal(filename, "/workspace/manifest.json");
        return Buffer.from(JSON.stringify({ Language: "kotlin" }));
      },
    },
    execSync() {
      throw { output: Buffer.from("Compilation failed.") };
    },
    async scenariosProvider() {
      return {
        heading: "Checkout order",
        executionIdentifier: "/workspace/specs/example.spec:3",
      };
    },
    async runner(command) {
      runCalls.push(command);
      return true;
    },
  });

  const result = await controller.handleCommand("gauge.execute.scenario");

  assert.equal(result, undefined);
  assert.deepEqual(runCalls, []);
  assert.deepEqual(errors, [
    "Error calculating project classpath.\t\nCompilation failed.",
  ]);
});

test("execute scenarios lets the user pick one provider scenario", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const { vscode, quickPicks } = createFakeVscode({
    quickPickSelection: { label: "Second scenario", detail: "Scenario" },
  });

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    async scenariosProvider() {
      return [
        {
          heading: "First scenario",
          executionIdentifier: "/workspace/specs/example.spec:4",
        },
        {
          heading: "Second scenario",
          executionIdentifier: "/workspace/specs/example.spec:10",
        },
      ];
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  await controller.handleCommand("gauge.execute.scenarios");

  assert.deepEqual(quickPicks, [
    {
      items: [
        { label: "First scenario", detail: "Scenario" },
        { label: "Second scenario", detail: "Scenario" },
      ],
      options: undefined,
    },
  ]);
  assert.deepEqual(calls, [
    {
      command: "gauge",
      args: ["run", "--hide-suggestion", "--simple-console", "/workspace/specs/example.spec:10"],
      cwd: "/workspace",
      status: "/workspace/specs/example.spec:10",
    },
  ]);
});

test("execute scenario reports scenario provider failures", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const { vscode, errors } = createFakeVscode();

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    async scenariosProvider() {
      throw new Error("missing client");
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  await assert.doesNotReject(() => controller.handleCommand("gauge.execute.scenario"));

  assert.deepEqual(errors, [
    "found some problems in /workspace/specs/example.spec. Fix all problems before running scenarios.",
  ]);
  assert.deepEqual(calls, []);
});

test("report command opens the last generated html report", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const opened = [];
  const { vscode } = createFakeVscode();

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    opener(reportPath) {
      opened.push(reportPath);
      return Promise.resolve(true);
    },
  });

  controller.processOutputLine(
    "Successfully generated html-report to => /workspace/reports/html-report/index.html",
  );
  await controller.handleCommand("gauge.report.html");

  assert.deepEqual(opened, ["/workspace/reports/html-report/index.html"]);
});

test("report command uses persistent Gauge state", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const opened = [];
  const stored = [];
  let reportPath;
  const { vscode } = createFakeVscode();

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    state: {
      setReportPath(nextReportPath) {
        stored.push(nextReportPath);
        reportPath = nextReportPath;
        return Promise.resolve(undefined);
      },
      getReportPath() {
        return reportPath;
      },
    },
    opener(nextReportPath) {
      opened.push(nextReportPath);
      return Promise.resolve(true);
    },
  });

  controller.processOutputLine(
    "Successfully generated html-report to =>  /workspace/reports/html-report/index.html ",
  );
  await controller.handleCommand("gauge.report.html");

  assert.deepEqual(stored, ["/workspace/reports/html-report/index.html"]);
  assert.deepEqual(opened, ["/workspace/reports/html-report/index.html"]);
});

test("report command shows an error when opening the html report fails", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const { vscode, errors } = createFakeVscode();

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    opener() {
      return Promise.reject(new Error("denied"));
    },
  });

  controller.setReportPath("/workspace/reports/html-report/index.html");
  await controller.handleCommand("gauge.report.html");

  assert.deepEqual(errors, ["Can't open html report. Error: denied"]);
});

test("debug node executes with JVM debug env and starts debugger on runner readiness", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  let finish;
  const { vscode } = createFakeVscode();

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/build.gradle.kts";
      },
    },
    debuggerFactory(debugOptions) {
      calls.push(["debugger", debugOptions.projectRoot, debugOptions.language]);
      return {
        async addDebugEnv(env) {
          calls.push(["env", env.PATH]);
          return {
            ...env,
            DEBUGGING: true,
            DEBUG_PORT: 5005,
            GAUGE_DEBUG_OPTS: 5005,
          };
        },
        addProcessId(pid) {
          calls.push(["pid", pid]);
        },
        startDebugger() {
          calls.push(["start"]);
          return Promise.resolve(true);
        },
        registerStopDebugger() {
          return {
            dispose() {
              calls.push(["dispose"]);
            },
          };
        },
        stopDebugger() {
          calls.push(["stop"]);
        },
      };
    },
    env: { PATH: "/bin" },
    runner(command) {
      calls.push(["runner", command]);
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });

  const run = controller.handleCommand("gauge.specexplorer.debugNode", {
    file: "/workspace/specs/example.spec",
    executionIdentifier: "/workspace/specs/example.spec:9",
  });
  await Promise.resolve();
  controller.processOutputLine("Runner Ready for Debugging at Process ID 2468");
  finish(true);

  assert.equal(await run, true);
  assert.deepEqual(calls, [
    ["debugger", "/workspace", "kotlin"],
    ["env", "/bin"],
    [
      "runner",
      {
        command: "gradle",
        args: [
          "clean",
          "gauge",
          "-PadditionalFlags=--hide-suggestion --simple-console",
          "-PspecsDir=specs/example.spec:9",
        ],
        cwd: "/workspace",
        status: "/workspace/specs/example.spec",
        env: {
          PATH: "/bin",
          DEBUGGING: true,
          DEBUG_PORT: 5005,
          GAUGE_DEBUG_OPTS: 5005,
        },
      },
    ],
    ["pid", 2468],
    ["start"],
    ["dispose"],
    ["stop"],
  ]);
});

test("executor closes a pending debugger attach when the run completes", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const attachEntered = deferred();
  const attachResponse = deferred();
  const runnerEntered = deferred();
  const runnerResponse = deferred();
  const calls = [];
  const { vscode } = createFakeVscode();

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/build.gradle.kts";
      },
    },
    debuggerFactory() {
      return {
        async addDebugEnv(env) {
          return env;
        },
        addProcessId() {},
        registerStopDebugger() {
          return {
            dispose() {
              calls.push("dispose");
            },
          };
        },
        startDebugger() {
          calls.push("attach");
          attachEntered.resolve();
          return attachResponse.promise;
        },
        stopDebugger() {
          calls.push("stop");
          return Promise.resolve(undefined);
        },
      };
    },
    runner() {
      runnerEntered.resolve();
      return runnerResponse.promise;
    },
  });

  const run = controller.handleCommand("gauge.specexplorer.debugNode", {
    file: "/workspace/specs/example.spec",
    executionIdentifier: "/workspace/specs/example.spec:9",
  });
  await runnerEntered.promise;
  controller.processOutputLine("Runner Ready for Debugging at Process ID 2468");
  await attachEntered.promise;

  runnerResponse.resolve(true);
  const result = await run;
  const callsBeforeAttachSettlement = [...calls];
  attachResponse.resolve(false);
  await new Promise((resolve) => setImmediate(resolve));
  controller.dispose();

  assert.equal(result, true);
  assert.deepEqual(callsBeforeAttachSettlement, ["attach", "dispose", "stop"]);
  assert.deepEqual(calls, ["attach", "dispose", "stop"]);
});

test("executor preserves a completed run when debugger cleanup throws", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  for (const failure of ["subscription", "stop"]) {
    const cleanupError = new Error(`debug ${failure} cleanup failed`);
    const runnerEntered = deferred();
    const runnerResponse = deferred();
    const { vscode } = createFakeVscode();
    let stopCalls = 0;

    const controller = createGaugeExecutionController({
      vscode,
      pathModule: path.posix,
      fileSystem: {
        existsSync(filename) {
          return filename === "/workspace/build.gradle.kts";
        },
      },
      debuggerFactory() {
        return {
          async addDebugEnv(env) {
            return env;
          },
          registerStopDebugger() {
            return {
              dispose() {
                if (failure === "subscription") {
                  throw cleanupError;
                }
              },
            };
          },
          stopDebugger() {
            stopCalls += 1;
            if (failure === "stop") {
              throw cleanupError;
            }
          },
        };
      },
      runner() {
        runnerEntered.resolve();
        return runnerResponse.promise;
      },
    });

    const run = controller.handleCommand("gauge.specexplorer.debugNode", {
      file: "/workspace/specs/example.spec",
      executionIdentifier: "/workspace/specs/example.spec:9",
    });
    await runnerEntered.promise;
    runnerResponse.resolve(true);

    assert.equal(await run, true);
    assert.equal(stopCalls, 1);
    controller.dispose();
  }
});

test("debug node uses the project runner language for debugger selection", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const languages = [];
  const { vscode } = createFakeVscode();

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/build.gradle.kts";
      },
    },
    projectFactory: {
      get(projectRoot) {
        assert.equal(projectRoot, "/workspace");
        return {
          language() {
            return "csharp";
          },
        };
      },
    },
    debuggerFactory(debugOptions) {
      languages.push(debugOptions.language);
      return {
        async addDebugEnv(env) {
          return {
            ...env,
            DEBUGGING: true,
          };
        },
        registerStopDebugger() {},
        stopDebugger() {},
      };
    },
    async runner() {
      return true;
    },
  });

  await controller.handleCommand("gauge.specexplorer.debugNode", {
    file: "/workspace/specs/example.spec",
    executionIdentifier: "/workspace/specs/example.spec:9",
  });

  assert.deepEqual(languages, ["csharp"]);
});

test("debug node ignores launch parallel options", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const { vscode } = createFakeVscode({
    launchConfigurations: [
      { type: "gauge", request: "test", name: "Gauge", parallel: true, n: 3 },
    ],
  });

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/build.gradle.kts";
      },
    },
    debuggerFactory() {
      return {
        async addDebugEnv(env) {
          return {
            ...env,
            DEBUGGING: true,
            DEBUG_PORT: 5005,
            GAUGE_DEBUG_OPTS: 5005,
          };
        },
        registerStopDebugger() {},
        stopDebugger() {},
      };
    },
    env: { PATH: "/bin" },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  const result = await controller.handleCommand("gauge.specexplorer.debugNode", {
    file: "/workspace/specs/example.spec",
    executionIdentifier: "/workspace/specs/example.spec:9",
  });

  assert.equal(result, true);
  assert.deepEqual(calls[0].args, [
    "clean",
    "gauge",
    "-PadditionalFlags=--hide-suggestion --simple-console",
    "-PspecsDir=specs/example.spec:9",
  ]);
});

test("debug node passes configured GAUGE_HOME to the debug environment", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
  const vscode = {
    StatusBarAlignment: {
      Left: "left",
    },
    commands: {
      executeCommand() {
        return Promise.resolve(undefined);
      },
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
      getConfiguration(section) {
        if (section === "launch") {
          return {
            get(key) {
              assert.equal(key, "configurations");
              return [];
            },
          };
        }
        assert.equal(section, "gauge");
        return {
          get(key) {
            return key === "home" ? "/custom/gauge-home" : undefined;
          },
        };
      },
    },
    window: {
      createStatusBarItem() {
        return {
          hide() {},
          show() {},
        };
      },
      showErrorMessage() {},
    },
  };

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/build.gradle.kts";
      },
    },
    debuggerFactory(debugOptions) {
      calls.push({ type: "debuggerBaseEnv", env: debugOptions.baseEnv });
      return {
        async addDebugEnv(env) {
          calls.push({ type: "addDebugEnv", env });
          return {
            ...env,
            DEBUGGING: true,
          };
        },
        registerStopDebugger() {},
        stopDebugger() {},
      };
    },
    env: { PATH: "/bin" },
    async runner(command) {
      calls.push({ type: "runnerEnv", env: command.env });
      return true;
    },
  });

  await controller.handleCommand("gauge.specexplorer.debugNode", {
    file: "/workspace/specs/example.spec",
    executionIdentifier: "/workspace/specs/example.spec:9",
  });

  assert.deepEqual(calls, [
    {
      type: "debuggerBaseEnv",
      env: {
        PATH: "/bin",
        GAUGE_HOME: "/custom/gauge-home",
      },
    },
    {
      type: "addDebugEnv",
      env: {
        PATH: "/bin",
        GAUGE_HOME: "/custom/gauge-home",
      },
    },
    {
      type: "runnerEnv",
      env: {
        PATH: "/bin",
        GAUGE_HOME: "/custom/gauge-home",
        DEBUGGING: true,
      },
    },
  ]);
});

test("debug node cancels Gauge execution when the debug session terminates", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const cancelCalls = [];
  let disposeCalls = 0;
  let finish;
  let stopCallback;
  const { vscode } = createFakeVscode();

  const controller = createGaugeExecutionController({
    vscode,
    pathModule: path.posix,
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/build.gradle.kts";
      },
    },
    debuggerFactory() {
      return {
        async addDebugEnv(env) {
          return {
            ...env,
            DEBUGGING: true,
            DEBUG_PORT: 5005,
            GAUGE_DEBUG_OPTS: 5005,
          };
        },
        registerStopDebugger(callback) {
          stopCallback = callback;
          return {
            dispose() {
              disposeCalls += 1;
            },
          };
        },
        stopDebugger() {},
      };
    },
    runner() {
      const run = new Promise((resolve) => {
        finish = resolve;
      });
      run.cancel = (aborted) => {
        cancelCalls.push(aborted);
        finish(false);
      };
      return run;
    },
  });

  const run = controller.handleCommand("gauge.specexplorer.debugNode", {
    file: "/workspace/specs/example.spec",
    executionIdentifier: "/workspace/specs/example.spec:9",
  });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(typeof stopCallback, "function");
  stopCallback({ name: "Gauge Debugger" });

  assert.equal(await run, false);
  assert.deepEqual(cancelCalls, [false]);
  assert.equal(disposeCalls, 1);
});

function createMavenExecutionFixture(overrides = {}) {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const buildToolCalls = [];
  const runnerCalls = [];
  const watchers = [];
  const fake = createFakeVscode(overrides);
  fake.vscode.workspace.createFileSystemWatcher = (glob) => {
    const watcher = {
      changeListeners: [],
      glob,
      onDidChange(listener) {
        watcher.changeListeners.push(listener);
        return { dispose() {} };
      },
      onDidCreate() {
        return { dispose() {} };
      },
      onDidDelete() {
        return { dispose() {} };
      },
      dispose() {},
    };
    watchers.push(watcher);
    return watcher;
  };
  const asCommand = (command) => ({
    command,
    argsForSpawnType(args) {
      return args;
    },
  });
  const controller = createGaugeExecutionController({
    vscode: fake.vscode,
    cli: {
      gaugeCommand() {
        return asCommand("gauge");
      },
      mavenCommand() {
        return asCommand("mvn");
      },
      gradleCommand() {
        return asCommand("gradle");
      },
    },
    pathModule: path.posix,
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/manifest.json"
          || filename === "/workspace/pom.xml";
      },
      readFileSync(filename) {
        assert.equal(filename, "/workspace/manifest.json");
        return Buffer.from(JSON.stringify({ Language: "kotlin" }));
      },
    },
    execSync(command, options) {
      buildToolCalls.push({ command, options, stopShown: fake.statusBarItems[0]
        ? fake.statusBarItems[0].showCalls > 0
        : false });
      return Buffer.from("/workspace/target/test-classes\n");
    },
    async runner(command) {
      runnerCalls.push(command);
      return true;
    },
  });
  return { buildToolCalls, controller, fake, runnerCalls, watchers };
}

test("execute shows the running status before any build tool work", async () => {
  const { buildToolCalls, controller } = createMavenExecutionFixture();

  await controller.handleCommand("gauge.execute.specification");

  assert.equal(buildToolCalls.length > 0, true);
  assert.equal(buildToolCalls[0].stopShown, true);
});

test("back-to-back Maven runs reuse compiled classes and the execution classpath", async () => {
  const { buildToolCalls, controller } = createMavenExecutionFixture();

  await controller.handleCommand("gauge.execute.specification");
  await controller.handleCommand("gauge.execute.specification");

  const classpathResolutions = buildToolCalls.filter((call) => call.command.includes("classpath"));
  const compiles = buildToolCalls.filter((call) => call.command.includes("test-compile"));
  assert.equal(classpathResolutions.length, 1);
  assert.equal(compiles.length, 1);
});

test("Maven source changes recompile without recalculating the classpath", async () => {
  const { buildToolCalls, controller, watchers } = createMavenExecutionFixture();

  await controller.handleCommand("gauge.execute.specification");
  const sourceWatcher = watchers.find((watcher) => watcher.glob === "**/src/**");
  assert.notEqual(sourceWatcher, undefined);
  sourceWatcher.changeListeners[0]({
    fsPath: "/workspace/src/test/kotlin/StepImplementation.kt",
  });
  await controller.handleCommand("gauge.execute.specification");

  const classpathResolutions = buildToolCalls.filter((call) => call.command.includes("classpath"));
  const compiles = buildToolCalls.filter((call) => call.command.includes("test-compile"));
  assert.equal(classpathResolutions.length, 1);
  assert.equal(compiles.length, 2);
});

test("build file changes invalidate the cached execution classpath", async () => {
  const { buildToolCalls, controller, watchers } = createMavenExecutionFixture();

  await controller.handleCommand("gauge.execute.specification");
  const buildWatcher = watchers.find((watcher) => watcher.glob.includes("pom.xml"));
  assert.notEqual(buildWatcher, undefined);
  buildWatcher.changeListeners[0]({ fsPath: "/workspace/pom.xml" });
  await controller.handleCommand("gauge.execute.specification");

  const classpathResolutions = buildToolCalls.filter((call) => call.command.includes("classpath"));
  const compiles = buildToolCalls.filter((call) => call.command.includes("test-compile"));
  assert.equal(classpathResolutions.length, 2);
  assert.equal(compiles.length, 2);
});
