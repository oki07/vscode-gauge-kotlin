const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

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

test("execute specification uses Maven args when Maven and Gradle files coexist", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
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
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  const result = await controller.handleCommand("gauge.execute.specification");

  assert.equal(result, true);
  assert.equal(calls[0].command, "mvn");
  assert.equal(calls[0].tool, mavenCommand);
  assert.deepEqual(calls[0].args, [
    "-q",
    "clean",
    "compile",
    "test-compile",
    "gauge:execute",
    "-Dtags=smoke",
    "-Dflags=--hide-suggestion,--simple-console",
    "-DspecsDir=specs/example.spec",
  ]);
});

test("execute specification resolves the project root from the active Gauge file", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  const calls = [];
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
    execSync() {
      return Buffer.from("");
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  const result = await controller.handleCommand("gauge.execute.specification");

  assert.equal(result, true);
  assert.deepEqual(errors, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "gradle");
  assert.deepEqual(calls[0].args, [
    "clean",
    "gauge",
    "-Ptags=smoke",
    "-PadditionalFlags=--hide-suggestion --simple-console",
    "-PspecsDir=specs/example.spec",
  ]);
  assert.equal(calls[0].cwd, "/outside/gauge");
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

test("execute in parallel runs the Gauge code lens target", async () => {
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

test("execute target accepts command flags for Test UI machine-readable runs", async () => {
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
    "machine-readable": true,
  });

  assert.deepEqual(calls[0].args, [
    "run",
    "--hide-suggestion",
    "--simple-console",
    "--machine-readable",
    "/workspace/specs/example.spec",
  ]);
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

test("executor rejects a new run while another run is in progress", async () => {
  const { createGaugeExecutionController } = require("../../src/execution/executor");
  let finish;
  const { vscode, errors } = createFakeVscode();

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

  const firstRun = controller.handleCommand("gauge.execute.specification.all");
  const secondRun = await controller.handleCommand("gauge.execute.specification.all");
  finish(true);
  await firstRun;

  assert.equal(secondRun, undefined);
  assert.deepEqual(errors, ["A Specification or Scenario is still running!"]);
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
      type: "suiteStarted",
      id: "/workspace/specs/example.spec",
      parentId: "suite",
      name: "Checkout",
      location: "gauge:///workspace/specs/example.spec:1",
    },
  ]);
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

test("machine-readable Test UI run emits synthetic failed event when Gauge exits before test events", async () => {
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
    "machine-readable": true,
  });

  assert.deepEqual(events, [
    {
      type: "testStarted",
      id: "Failed",
      parentId: "suite",
      name: "Failed",
    },
    {
      type: "testFailed",
      id: "Failed",
      parentId: "suite",
      name: "Failed",
      message: " ",
    },
    {
      type: "testFinished",
      id: "Failed",
      parentId: "suite",
      name: "Failed",
    },
  ]);
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
    "machine-readable": true,
  });

  assert.deepEqual(calls, [
    {
      command: "gauge",
      args: [
        "run",
        "--hide-suggestion",
        "--simple-console",
        "--machine-readable",
        "/workspace/specs/example.spec:8",
      ],
      cwd: "/workspace",
      status: "/workspace/specs/example.spec:8",
    },
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
  ]);
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
});
