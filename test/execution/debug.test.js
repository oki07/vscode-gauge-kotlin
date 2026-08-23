const assert = require("node:assert/strict");
const test = require("node:test");

test("GaugeDebugger adds JVM debug environment for Kotlin projects", async () => {
  const { createGaugeDebugger } = require("../../src/execution/debug");

  const debuggerSession = createGaugeDebugger({
    projectRoot: "/workspace",
    language: "kotlin",
    baseEnv: { PATH: "/bin" },
    async debugPortProvider() {
      return 5005;
    },
  });

  const env = await debuggerSession.addDebugEnv();

  assert.deepEqual(env, {
    PATH: "/bin",
    DEBUGGING: true,
    use_nested_specs: "false",
    SHOULD_BUILD_PROJECT: "true",
    GAUGE_DEBUG_OPTS: 5005,
    DEBUG_PORT: 5005,
  });
  assert.deepEqual(debuggerSession.getDebuggerConfiguration(), {
    name: "Gauge Debugger",
    type: "java",
    request: "attach",
    hostName: "127.0.0.1",
    port: 5005,
  });
});

test("GaugeDebugger starts VS Code Java attach debugging", async () => {
  const { createGaugeDebugger } = require("../../src/execution/debug");
  const calls = [];
  const vscode = {
    workspace: {
      getWorkspaceFolder(uri) {
        calls.push(["folder", uri]);
        return { uri, name: "workspace" };
      },
    },
    Uri: {
      file(filename) {
        return { fsPath: filename };
      },
    },
    debug: {
      async startDebugging(folder, configuration) {
        calls.push(["start", folder, configuration]);
        return true;
      },
    },
  };

  const debuggerSession = createGaugeDebugger({
    vscode,
    projectRoot: "/workspace",
    language: "kotlin",
    async debugPortProvider() {
      return 5005;
    },
  });

  await debuggerSession.addDebugEnv();
  const result = await debuggerSession.startDebugger();
  const { __gaugeExecutionId, ...debugConfiguration } = calls[1][2];

  assert.equal(result, true);
  assert.match(__gaugeExecutionId, /^gauge-debug-\d+$/);
  assert.deepEqual(calls, [
    ["folder", { fsPath: "/workspace" }],
    [
      "start",
      { uri: { fsPath: "/workspace" }, name: "workspace" },
      calls[1][2],
    ],
  ]);
  assert.deepEqual(debugConfiguration, {
    name: "Gauge Debugger",
    type: "java",
    request: "attach",
    hostName: "127.0.0.1",
    port: 5005,
  });
});

test("GaugeDebugger retries VS Code attach debugging while the runner starts", async () => {
  const { createGaugeDebugger } = require("../../src/execution/debug");
  const attempts = [];
  const sleeps = [];
  const vscode = {
    workspace: {
      getWorkspaceFolder(uri) {
        return { uri, name: "workspace" };
      },
    },
    Uri: {
      file(filename) {
        return { fsPath: filename };
      },
    },
    debug: {
      async startDebugging(folder, configuration) {
        attempts.push({ folder, configuration });
        if (attempts.length < 3) {
          throw new Error("debug port is not ready");
        }
        return true;
      },
    },
  };

  const debuggerSession = createGaugeDebugger({
    vscode,
    projectRoot: "/workspace",
    language: "kotlin",
    debugStartDelayMs: 100,
    debugAttachRetryDelayMs: 5000,
    debugAttachTimeoutMs: 11000,
    async sleep(milliseconds) {
      sleeps.push(milliseconds);
    },
    async debugPortProvider() {
      return 5005;
    },
  });

  await debuggerSession.addDebugEnv();
  const result = await debuggerSession.startDebugger();
  const { __gaugeExecutionId, ...debugConfiguration } = attempts[2].configuration;

  assert.equal(result, true);
  assert.deepEqual(sleeps, [100, 5000, 5000]);
  assert.equal(attempts.length, 3);
  assert.match(__gaugeExecutionId, /^gauge-debug-\d+$/);
  assert.deepEqual(debugConfiguration, {
    name: "Gauge Debugger",
    type: "java",
    request: "attach",
    hostName: "127.0.0.1",
    port: 5005,
  });
});

test("GaugeDebugger uses the configured Gauge debug port by default", async () => {
  const { createGaugeDebugger } = require("../../src/execution/debug");
  const vscode = {
    workspace: {
      getConfiguration(section) {
        assert.equal(section, "gauge");
        return {
          get(key) {
            assert.equal(key, "execution.debugPort");
            return 6006;
          },
        };
      },
    },
  };

  const debuggerSession = createGaugeDebugger({
    vscode,
    projectRoot: "/workspace",
    language: "kotlin",
    baseEnv: { PATH: "/bin" },
    async getPort(options) {
      assert.deepEqual(options, { port: 6006 });
      return 6006;
    },
  });

  const env = await debuggerSession.addDebugEnv();

  assert.equal(env.DEBUG_PORT, 6006);
  assert.equal(env.GAUGE_DEBUG_OPTS, 6006);
  assert.equal(debuggerSession.getDebuggerConfiguration().port, 6006);
});

test("GaugeDebugger resolves the configured debug port to an available port", async () => {
  const { createGaugeDebugger } = require("../../src/execution/debug");
  const getPortCalls = [];
  const vscode = {
    workspace: {
      getConfiguration(section) {
        assert.equal(section, "gauge");
        return {
          get(key) {
            assert.equal(key, "execution.debugPort");
            return 6006;
          },
        };
      },
    },
  };

  const debuggerSession = createGaugeDebugger({
    vscode,
    projectRoot: "/workspace",
    language: "kotlin",
    baseEnv: { PATH: "/bin" },
    async getPort(options) {
      getPortCalls.push(options);
      return 6010;
    },
  });

  const env = await debuggerSession.addDebugEnv();

  assert.deepEqual(getPortCalls, [{ port: 6006 }]);
  assert.equal(env.DEBUG_PORT, 6010);
  assert.equal(env.GAUGE_DEBUG_OPTS, 6010);
  assert.equal(debuggerSession.getDebuggerConfiguration().port, 6010);
});

test("GaugeDebugger maps Gauge runner languages to VS Code debug adapters", async () => {
  const { createGaugeDebugger } = require("../../src/execution/debug");

  async function configurationFor(language, processId) {
    const debuggerSession = createGaugeDebugger({
      projectRoot: "/workspace/gauge",
      language,
      async debugPortProvider() {
        return 5005;
      },
    });
    await debuggerSession.addDebugEnv();
    if (processId !== undefined) {
      debuggerSession.addProcessId(processId);
    }
    return debuggerSession.getDebuggerConfiguration();
  }

  assert.deepEqual(await configurationFor("python"), {
    name: "Gauge Debugger",
    type: "python",
    request: "attach",
    port: 5005,
    localRoot: "/workspace/gauge",
  });
  assert.deepEqual(await configurationFor("javascript"), {
    name: "Gauge Debugger",
    type: "node",
    request: "attach",
    port: 5005,
    protocol: "inspector",
  });
  assert.deepEqual(await configurationFor("typescript"), {
    name: "Gauge Debugger",
    type: "node",
    runtimeArgs: ["--nolazy", "-r", "ts-node/register"],
    request: "attach",
    sourceMaps: true,
    port: 5005,
    protocol: "inspector",
  });
  assert.deepEqual(await configurationFor("ruby"), {
    name: "Gauge Debugger",
    type: "Ruby",
    request: "attach",
    cwd: "/workspace/gauge",
    remoteWorkspaceRoot: "/workspace/gauge",
    remoteHost: "127.0.0.1",
    remotePort: 5005,
  });
  assert.deepEqual(await configurationFor("csharp", 12345), {
    name: "Gauge Debugger",
    type: "coreclr",
    request: "attach",
    processId: 12345,
    justMyCode: true,
    sourceFileMap: {},
  });
});

test("GaugeDebugger adds C# debug environment for dotnet projects", async () => {
  const { createGaugeDebugger } = require("../../src/execution/debug");
  const debuggerSession = createGaugeDebugger({
    projectRoot: "/workspace/gauge",
    language: "csharp",
    baseEnv: { PATH: "/bin" },
    async debugPortProvider() {
      return 5005;
    },
  });

  const env = await debuggerSession.addDebugEnv();

  assert.deepEqual(env, {
    PATH: "/bin",
    DEBUGGING: true,
    use_nested_specs: "false",
    SHOULD_BUILD_PROJECT: "true",
    GAUGE_CSHARP_PROJECT_CONFIG: "Debug",
    DEBUG_PORT: 5005,
  });
});

test("GaugeDebugger copies C# launch debug options", async () => {
  const { createGaugeDebugger } = require("../../src/execution/debug");
  const vscode = {
    Uri: {
      file(filename) {
        return { fsPath: filename };
      },
    },
    workspace: {
      workspaceFolders: [
        { uri: { fsPath: "/workspace/gauge" } },
      ],
      getConfiguration(section, scope) {
        if (section === "gauge") {
          return {
            get(key) {
              assert.equal(key, "execution.debugPort");
              return 5005;
            },
          };
        }
        assert.equal(section, "launch");
        assert.deepEqual(scope, { fsPath: "/workspace/gauge" });
        return {
          get(key) {
            assert.equal(key, "configurations");
            return [
              {
                justMyCode: false,
                sourceFileMap: {
                  "/remote": "/workspace/gauge",
                },
              },
            ];
          },
        };
      },
    },
  };
  const debuggerSession = createGaugeDebugger({
    vscode,
    projectRoot: "/workspace/gauge",
    language: "csharp",
    async debugPortProvider() {
      return 5005;
    },
  });

  await debuggerSession.addDebugEnv();
  debuggerSession.addProcessId(12345);

  assert.deepEqual(debuggerSession.getDebuggerConfiguration(), {
    name: "Gauge Debugger",
    type: "coreclr",
    request: "attach",
    processId: 12345,
    justMyCode: false,
    sourceFileMap: {
      "/remote": "/workspace/gauge",
    },
  });
});

test("GaugeDebugger owns only the debug session it starts", async () => {
  const { createGaugeDebugger } = require("../../src/execution/debug");
  const startCallbacks = [];
  const terminateCallbacks = [];
  const calls = [];
  const unrelatedSession = {
    configuration: {},
    id: "unrelated",
    name: "Gauge Debugger",
  };
  let ownedSession;
  const vscode = {
    workspace: {
      getWorkspaceFolder(uri) {
        return { uri, name: "workspace" };
      },
    },
    Uri: {
      file(filename) {
        return { fsPath: filename };
      },
    },
    debug: {
      activeDebugSession: unrelatedSession,
      onDidStartDebugSession(callback) {
        startCallbacks.push(callback);
        return {
          dispose() {
            calls.push(["dispose", "start"]);
          },
        };
      },
      onDidTerminateDebugSession(callback) {
        terminateCallbacks.push(callback);
        return {
          dispose() {
            calls.push(["dispose", "terminate"]);
          },
        };
      },
      async startDebugging(_folder, configuration) {
        ownedSession = {
          configuration,
          id: "owned",
          name: "Gauge Debugger",
        };
        vscode.debug.activeDebugSession = ownedSession;
        startCallbacks[0](ownedSession);
        return true;
      },
      async stopDebugging(session) {
        calls.push(["stop", session.id]);
      },
    },
  };

  const debuggerSession = createGaugeDebugger({
    vscode,
    projectRoot: "/workspace",
    language: "kotlin",
    debugStartDelayMs: 0,
    async debugPortProvider() {
      return 5005;
    },
  });
  await debuggerSession.addDebugEnv();
  const subscription = debuggerSession.registerStopDebugger((session) => {
    calls.push(["terminated", session.id]);
  });

  terminateCallbacks[0](unrelatedSession);
  assert.deepEqual(calls, []);

  await debuggerSession.startDebugger();
  const correlatedChildSession = {
    configuration: ownedSession.configuration,
    id: "owned-child",
    name: "Gauge Debugger Child",
  };
  vscode.debug.activeDebugSession = unrelatedSession;
  await debuggerSession.stopDebugger();
  terminateCallbacks[0](unrelatedSession);
  terminateCallbacks[0](correlatedChildSession);
  terminateCallbacks[0](ownedSession);
  subscription.dispose();

  assert.deepEqual(calls, [
    ["dispose", "start"],
    ["stop", "owned"],
    ["terminated", "owned"],
    ["dispose", "terminate"],
  ]);
});
