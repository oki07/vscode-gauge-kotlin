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

  assert.equal(result, true);
  assert.deepEqual(calls, [
    ["folder", { fsPath: "/workspace" }],
    [
      "start",
      { uri: { fsPath: "/workspace" }, name: "workspace" },
      {
        name: "Gauge Debugger",
        type: "java",
        request: "attach",
        hostName: "127.0.0.1",
        port: 5005,
      },
    ],
  ]);
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

  assert.equal(result, true);
  assert.deepEqual(sleeps, [100, 5000, 5000]);
  assert.equal(attempts.length, 3);
  assert.deepEqual(attempts[2].configuration, {
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

test("GaugeDebugger registers debug session termination callbacks", () => {
  const { createGaugeDebugger } = require("../../src/execution/debug");
  const callbacks = [];
  const calls = [];
  const vscode = {
    debug: {
      onDidTerminateDebugSession(callback) {
        callbacks.push(callback);
        return {
          dispose() {
            calls.push(["dispose"]);
          },
        };
      },
    },
  };

  const debuggerSession = createGaugeDebugger({
    vscode,
    projectRoot: "/workspace",
    language: "kotlin",
  });
  debuggerSession.registerStopDebugger((session) => {
    calls.push(["terminated", session.name]);
  });

  callbacks[0]({ name: "Gauge Debugger" });

  assert.deepEqual(calls, [
    ["terminated", "Gauge Debugger"],
  ]);
});
