const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

function createFakeVscode(overrides = {}) {
  const errors = [];
  const quickPicks = [];
  const workspaceFolders = overrides.workspaceFolders || [
    { uri: { fsPath: "/workspace" } },
  ];
  return {
    errors,
    quickPicks,
    vscode: {
      workspace: {
        workspaceFolders,
        getConfiguration(section) {
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
    },
    async runner(command) {
      calls.push(command);
      return true;
    },
  });

  const result = await controller.handleCommand("gauge.execute.specification");

  assert.equal(result, true);
  assert.deepEqual(errors, []);
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
      cwd: "/outside/gauge",
      status: "/outside/gauge/specs/example.spec",
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
