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
