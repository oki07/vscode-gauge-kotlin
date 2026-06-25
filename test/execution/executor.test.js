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
