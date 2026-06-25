const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

function createFakeFileSystem(entries) {
  const files = new Map(Object.entries(entries));
  return {
    existsSync(filename) {
      return files.has(filename);
    },
    readFileSync(filename) {
      if (!files.has(filename)) {
        throw new Error(`Missing ${filename}`);
      }
      return Buffer.from(files.get(filename));
    },
  };
}

function createFakeVscode(overrides = {}) {
  const contexts = [];
  const quickPicks = [];
  const configurations = overrides.configurations || {};
  const workspaceFolders = overrides.workspaceFolders || [
    { uri: { fsPath: "/workspace/gauge" } },
  ];
  return {
    contexts,
    quickPicks,
    vscode: {
      Uri: {
        file(filename) {
          return { fsPath: filename };
        },
      },
      CancellationTokenSource: class CancellationTokenSource {
        constructor() {
          this.token = { cancelled: false };
        }
      },
      commands: {
        executeCommand(command, key, value) {
          contexts.push({ command, key, value });
          return Promise.resolve(undefined);
        },
      },
      window: {
        createOutputChannel() {
          return { appendLine() {}, clear() {}, show() {} };
        },
        showQuickPick(items, options) {
          quickPicks.push({ items, options });
          return Promise.resolve(overrides.quickPickSelection || items[0]);
        },
        showErrorMessage() {
          return Promise.resolve(undefined);
        },
      },
      workspace: {
        workspaceFolders,
        getWorkspaceFolder(uri) {
          return workspaceFolders.find((folder) => folder.uri.fsPath === uri.fsPath);
        },
        getConfiguration(section) {
          const values = configurations[section] || {};
          return {
            get(key) {
              return values[key];
            },
            has(key) {
              return Object.prototype.hasOwnProperty.call(values, key);
            },
          };
        },
        onDidChangeWorkspaceFolders() {
          return { dispose() {} };
        },
        onDidChangeConfiguration() {
          return { dispose() {} };
        },
      },
    },
  };
}

class FakeLanguageClient {
  constructor(id, name, serverOptions, clientOptions) {
    this.id = id;
    this.name = name;
    this.serverOptions = serverOptions;
    this.clientOptions = clientOptions;
    this.started = false;
    this.stopped = false;
    this.features = [];
  }

  start() {
    this.started = true;
    return Promise.resolve();
  }

  stop() {
    this.stopped = true;
    return Promise.resolve();
  }

  registerFeatures(features) {
    this.features.push(...features);
  }

  sendRequest(method) {
    assert.equal(method, "gauge/getRunnerLanguage");
    return Promise.resolve("kotlin");
  }
}

test("GaugeWorkspace starts Gauge LSP clients for workspace projects", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({
      Language: "kotlin",
      Plugins: [{ name: "kotlin" }],
    }),
    "/workspace/gauge/build.gradle.kts": "",
  });
  const { contexts, vscode } = createFakeVscode({
    configurations: {
      "gauge.launch": { enableDebugLogs: true },
      "gauge.codeLenses": { reference: false },
    },
  });
  const cli = new CLI(new Command("gauge"), {
    version: "1.2.3",
    plugins: [{ name: "kotlin", version: "0.9.0" }],
  }, new Command("mvn"), new Command("gradle"));

  const workspace = new GaugeWorkspace({
    cli,
    clientsMap: clients,
    fileSystem,
    env: { PATH: "/bin" },
    execSync() {
      return Buffer.from("");
    },
    LanguageClient: FakeLanguageClient,
    RevealOutputChannelOn: { Never: 4 },
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  const entry = clients.get("/workspace/gauge/specs/example.spec");
  assert.equal(entry.project.language(), "kotlin");
  assert.equal(entry.client.started, true);
  assert.deepEqual(entry.client.serverOptions, {
    command: "gauge",
    args: ["daemon", "--lsp", "--dir", "/workspace/gauge", "-l", "debug"],
    options: {
      env: {
        GAUGE_IGNORE_RUNNER_BUILD_FAILURES: "true",
        PATH: "/bin",
        gauge_custom_classpath: "",
        gauge_lsp_reference_codelens: "false",
      },
    },
  });
  assert.deepEqual(entry.client.clientOptions.documentSelector, [
    { scheme: "file", language: "gauge", pattern: "/workspace/gauge/**/*" },
  ]);
  assert.equal(entry.client.clientOptions.revealOutputChannelOn, 4);
  assert.equal(entry.client.clientOptions.workspaceFolder.uri.fsPath, "/workspace/gauge");
  assert.equal(entry.client.features.length, 1);
  assert.equal(entry.client.features[0].messages.method, "workspace/saveFiles");
  assert.equal(workspace.getClientLanguageMap().get("/workspace/gauge"), "kotlin");
  assert.deepEqual(contexts, [
    { command: "setContext", key: "gauge:multipleProjects?", value: false },
  ]);
});

test("GaugeWorkspace generates Java config for non-Maven Java projects", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const generatedConfigs = [];
  const env = { PATH: "/bin" };
  const gaugeConfig = { id: "gaugeConfig" };
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({
      Language: "java",
      Plugins: [{ name: "java" }],
    }),
  });
  const { vscode } = createFakeVscode();
  const cli = new CLI(new Command("gauge"), {
    version: "1.2.3",
    plugins: [{ name: "java", version: "1.0.0" }],
  });

  class FakeJavaProjectConfig {
    constructor(projectRoot, pluginVersion, receivedGaugeConfig) {
      this.projectRoot = projectRoot;
      this.pluginVersion = pluginVersion;
      this.gaugeConfig = receivedGaugeConfig;
    }

    generate() {
      generatedConfigs.push({
        gaugeConfig: this.gaugeConfig,
        pluginVersion: this.pluginVersion,
        projectRoot: this.projectRoot,
      });
    }
  }

  const workspace = new GaugeWorkspace({
    cli,
    clientsMap: clients,
    env,
    fileSystem,
    JavaProjectConfig: FakeJavaProjectConfig,
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    platform() {
      return "darwin";
    },
    gaugeConfigFactory(platformName) {
      assert.equal(platformName, "darwin");
      return gaugeConfig;
    },
    vscode,
  });
  await workspace.ready();

  const entry = clients.get("/workspace/gauge");
  assert.deepEqual(generatedConfigs, [
    {
      gaugeConfig,
      pluginVersion: "1.0.0",
      projectRoot: "/workspace/gauge",
    },
  ]);
  assert.equal(env.SHOULD_BUILD_PROJECT, "false");
  assert.equal(entry.client.serverOptions.options.env.SHOULD_BUILD_PROJECT, "false");
});

test("GaugeWorkspace lets users choose among known projects", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const clients = new GaugeClients();
  const fileSystem = createFakeFileSystem({
    "/workspace/one/manifest.json": JSON.stringify({ Language: "kotlin", Plugins: [] }),
    "/workspace/two/manifest.json": JSON.stringify({ Language: "kotlin", Plugins: [] }),
  });
  const { quickPicks, vscode } = createFakeVscode({
    workspaceFolders: [
      { uri: { fsPath: "/workspace/one" } },
      { uri: { fsPath: "/workspace/two" } },
    ],
    quickPickSelection: { label: "two", description: "/workspace/two" },
  });

  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), { plugins: [{ name: "kotlin", version: "0.9.0" }] }),
    clientsMap: clients,
    fileSystem,
    LanguageClient: FakeLanguageClient,
    pathModule: path.posix,
    vscode,
  });
  await workspace.ready();

  const selected = await workspace.showProjectOptions((projectRoot) => projectRoot);

  assert.equal(selected, "/workspace/two");
  assert.deepEqual(quickPicks, [
    {
      items: [
        { label: "one", description: "/workspace/one" },
        { label: "two", description: "/workspace/two" },
      ],
      options: { canPickMany: false, placeHolder: "Choose a project" },
    },
  ]);
});

test("GaugeWorkspace stores the last html report path in state", async () => {
  const { CLI, Command } = require("../src/cli");
  const { GaugeWorkspace } = require("../src/gaugeWorkspace");
  const state = {};
  const { vscode } = createFakeVscode({ workspaceFolders: [] });
  const workspace = new GaugeWorkspace({
    cli: new CLI(new Command("gauge"), { plugins: [] }),
    clientsMap: new Map(),
    LanguageClient: FakeLanguageClient,
    state: {
      setReportPath(reportPath) {
        state.report = reportPath;
      },
      getReportPath() {
        return state.report;
      },
    },
    vscode,
  });
  await workspace.ready();

  workspace.setReportPath(" /workspace/reports/html-report/index.html ");

  assert.equal(workspace.getReportPath(), "/workspace/reports/html-report/index.html");
});
