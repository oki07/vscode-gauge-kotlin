const assert = require("node:assert/strict");
const test = require("node:test");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

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

test("GaugeDebugger closes a pending initial attach when stopped", async () => {
  const { createGaugeDebugger } = require("../../src/execution/debug");

  for (const settlement of ["resolve", "reject"]) {
    const sleepEntered = deferred();
    const sleepResponse = deferred();
    let folderCalls = 0;
    let startCalls = 0;
    const vscode = {
      workspace: {
        getWorkspaceFolder(uri) {
          folderCalls += 1;
          return { uri, name: "workspace" };
        },
      },
      Uri: {
        file(filename) {
          return { fsPath: filename };
        },
      },
      debug: {
        async startDebugging() {
          startCalls += 1;
          return true;
        },
      },
    };
    const debuggerSession = createGaugeDebugger({
      vscode,
      projectRoot: "/workspace",
      language: "kotlin",
      sleep() {
        sleepEntered.resolve();
        return sleepResponse.promise;
      },
    });

    let outcome;
    const started = debuggerSession.startDebugger().then(
      (value) => {
        outcome = { status: "fulfilled", value };
        return value;
      },
      (reason) => {
        outcome = { reason, status: "rejected" };
        return undefined;
      },
    );
    await sleepEntered.promise;

    await debuggerSession.stopDebugger();
    await nextTurn();
    const outcomeBeforeSleep = outcome;
    if (settlement === "resolve") {
      sleepResponse.resolve();
    } else {
      sleepResponse.reject(new Error("late sleep failure"));
    }
    await started;
    await nextTurn();
    const postStopResult = await debuggerSession.startDebugger();

    assert.deepEqual({
      folderCalls,
      outcome,
      outcomeBeforeSleep,
      postStopResult,
      startCalls,
    }, {
      folderCalls: 1,
      outcome: { status: "fulfilled", value: false },
      outcomeBeforeSleep: { status: "fulfilled", value: false },
      postStopResult: false,
      startCalls: 0,
    });
  }
});

test("GaugeDebugger stops retrying while an attach delay is pending", async () => {
  const { createGaugeDebugger } = require("../../src/execution/debug");
  const retryEntered = deferred();
  const retryResponse = deferred();
  const attempts = [];
  let sleepCalls = 0;
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
      async startDebugging() {
        attempts.push("start");
        if (attempts.length === 1) {
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
    debugStartDelayMs: 0,
    debugAttachRetryDelayMs: 5000,
    debugAttachTimeoutMs: 10000,
    sleep() {
      sleepCalls += 1;
      if (sleepCalls === 1) {
        return Promise.resolve();
      }
      retryEntered.resolve();
      return retryResponse.promise;
    },
  });

  let outcome;
  const started = debuggerSession.startDebugger().then((value) => {
    outcome = value;
    return value;
  });
  await retryEntered.promise;

  await debuggerSession.stopDebugger();
  await nextTurn();
  const outcomeBeforeRetry = outcome;
  retryResponse.resolve();
  const result = await started;

  assert.deepEqual({
    attempts,
    outcomeBeforeRetry,
    result,
    sleepCalls,
  }, {
    attempts: ["start"],
    outcomeBeforeRetry: false,
    result: false,
    sleepCalls: 2,
  });
});

test("GaugeDebugger keeps one attach operation per execution", async () => {
  const { createGaugeDebugger } = require("../../src/execution/debug");
  const startEntered = deferred();
  const startResponse = deferred();
  let startCalls = 0;
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
      startDebugging() {
        startCalls += 1;
        startEntered.resolve();
        return startResponse.promise;
      },
    },
  };
  const debuggerSession = createGaugeDebugger({
    vscode,
    projectRoot: "/workspace",
    language: "kotlin",
    debugStartDelayMs: 0,
    sleep: () => Promise.resolve(),
  });

  const first = debuggerSession.startDebugger();
  await startEntered.promise;
  let secondOutcome;
  const second = debuggerSession.startDebugger().then((value) => {
    secondOutcome = value;
    return value;
  });
  await nextTurn();
  const secondBeforeStop = secondOutcome;

  await debuggerSession.stopDebugger();
  startResponse.resolve(true);
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.deepEqual({
    firstResult,
    secondBeforeStop,
    secondResult,
    startCalls,
  }, {
    firstResult: false,
    secondBeforeStop: false,
    secondResult: false,
    startCalls: 1,
  });

  let completedStartCalls = 0;
  const completedDebugger = createGaugeDebugger({
    vscode: {
      ...vscode,
      debug: {
        activeDebugSession: undefined,
        async startDebugging(_folder, configuration) {
          completedStartCalls += 1;
          this.activeDebugSession = {
            configuration,
            id: "completed",
            name: "Gauge Debugger",
          };
          return true;
        },
      },
    },
    projectRoot: "/workspace",
    language: "kotlin",
    debugStartDelayMs: 0,
    sleep: () => Promise.resolve(),
  });

  assert.equal(await completedDebugger.startDebugger(), true);
  assert.equal(await completedDebugger.startDebugger(), false);
  assert.equal(completedStartCalls, 1);
});

test("GaugeDebugger preserves live attach failures", async () => {
  const { createGaugeDebugger } = require("../../src/execution/debug");
  const attachError = new Error("debug adapter unavailable");
  let startResult = Promise.reject(attachError);
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
      startDebugging() {
        return startResult;
      },
    },
  };
  const debuggerSession = createGaugeDebugger({
    vscode,
    projectRoot: "/workspace",
    language: "kotlin",
    debugStartDelayMs: 0,
    debugAttachRetryDelayMs: 0,
    debugAttachTimeoutMs: 0,
    sleep: () => Promise.resolve(),
  });

  await assert.rejects(
    debuggerSession.startDebugger(),
    (error) => error === attachError,
  );

  startResult = Promise.resolve(false);
  const falseDebuggerSession = createGaugeDebugger({
    vscode,
    projectRoot: "/workspace",
    language: "kotlin",
    debugStartDelayMs: 0,
    debugAttachRetryDelayMs: 0,
    debugAttachTimeoutMs: 0,
    sleep: () => Promise.resolve(),
  });
  await assert.rejects(
    falseDebuggerSession.startDebugger(),
    (error) => error.message === "VS Code did not start the debugger.",
  );
});

test("GaugeDebugger stops an owned session that starts after attach cancellation", async () => {
  const { createGaugeDebugger } = require("../../src/execution/debug");

  for (const scenario of [
    { retry: false, settlement: "resolve" },
    { retry: true, settlement: "resolve" },
    { activeFallback: true, retry: false, settlement: "resolve" },
    { retry: false, settlement: "false" },
    { retry: false, settlement: "reject" },
    { retry: false, settlement: "resolve", synchronousStart: true },
    { retry: false, settlement: "resolve", stopFailure: "throw" },
    { retry: false, settlement: "resolve", stopFailure: "reject" },
  ]) {
    const startEntered = deferred();
    const startResponse = deferred();
    const startListeners = new Set();
    const stopCalls = [];
    let configuration;
    let hostStartCalls = 0;
    let startListenerDisposals = 0;
    let startListenerRegistrations = 0;
    const unrelatedSession = {
      configuration: {},
      id: "unrelated",
      name: "Unrelated",
    };
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
          startListenerRegistrations += 1;
          startListeners.add(callback);
          if (scenario.synchronousStart && startListenerRegistrations === 2) {
            callback({
              configuration,
              id: "owned",
              name: "Gauge Debugger",
            });
          }
          return {
            dispose() {
              if (startListeners.delete(callback)) {
                startListenerDisposals += 1;
              }
            },
          };
        },
        startDebugging(_folder, debugConfiguration) {
          hostStartCalls += 1;
          configuration = debugConfiguration;
          if (scenario.retry && hostStartCalls === 1) {
            return Promise.resolve(false);
          }
          startEntered.resolve();
          return startResponse.promise;
        },
        stopDebugging(session) {
          stopCalls.push(session);
          if (scenario.stopFailure === "throw") {
            throw new Error("late debugger stop failed");
          }
          if (scenario.stopFailure === "reject") {
            return Promise.reject(new Error("late debugger stop failed"));
          }
          return Promise.resolve(true);
        },
      },
    };
    const debuggerSession = createGaugeDebugger({
      vscode,
      projectRoot: "/workspace",
      language: "kotlin",
      debugStartDelayMs: 0,
      debugAttachRetryDelayMs: 1,
      debugAttachTimeoutMs: 2,
      sleep: () => Promise.resolve(),
    });
    const externalSubscription = debuggerSession.registerStopDebugger(() => {});

    let outcome;
    const started = debuggerSession.startDebugger().then((value) => {
      outcome = value;
      return value;
    });
    await startEntered.promise;

    externalSubscription.dispose();
    await debuggerSession.stopDebugger();
    await nextTurn();
    const outcomeBeforeHost = outcome;
    if (scenario.settlement === "resolve") {
      const ownedSession = {
        configuration,
        id: "owned",
        name: "Gauge Debugger",
      };
      if (!scenario.synchronousStart && !scenario.activeFallback) {
        for (const listener of [...startListeners]) {
          listener(unrelatedSession);
        }
        assert.deepEqual(stopCalls, []);
        assert.equal(startListeners.size, 1);
        for (const listener of [...startListeners]) {
          listener(ownedSession);
        }
      }
      vscode.debug.activeDebugSession = scenario.activeFallback
        ? ownedSession
        : unrelatedSession;
      startResponse.resolve(true);
    } else if (scenario.settlement === "false") {
      startResponse.resolve(false);
    } else {
      startResponse.reject(new Error("late attach failure"));
    }
    const result = await started;
    await nextTurn();

    assert.equal(outcomeBeforeHost, false);
    assert.equal(result, false);
    assert.equal(startListeners.size, 0);
    assert.equal(startListenerDisposals, startListenerRegistrations);
    assert.equal(startListenerRegistrations, 2);
    assert.equal(hostStartCalls, scenario.retry ? 2 : 1);
    if (scenario.settlement === "resolve") {
      assert.equal(stopCalls.length, 1);
      assert.equal(stopCalls[0].id, "owned");
    } else {
      assert.deepEqual(stopCalls, []);
    }
  }
});

test("GaugeDebugger releases a synchronously started session subscription", async () => {
  const { createGaugeDebugger } = require("../../src/execution/debug");
  let ownedSession;
  let startDisposals = 0;
  let terminationDisposals = 0;
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
      activeDebugSession: undefined,
      onDidStartDebugSession(callback) {
        callback(ownedSession);
        return {
          dispose() {
            startDisposals += 1;
            throw new Error("start subscription cleanup failed");
          },
        };
      },
      onDidTerminateDebugSession() {
        return {
          dispose() {
            terminationDisposals += 1;
            throw new Error("termination subscription cleanup failed");
          },
        };
      },
      async startDebugging(_folder, configuration) {
        ownedSession = {
          configuration,
          id: "owned",
          name: "Gauge Debugger",
        };
        this.activeDebugSession = ownedSession;
        return true;
      },
    },
  };
  const debuggerSession = createGaugeDebugger({
    vscode,
    projectRoot: "/workspace",
    language: "kotlin",
    debugStartDelayMs: 0,
    sleep: () => Promise.resolve(),
  });
  await debuggerSession.startDebugger();

  let subscription;
  assert.doesNotThrow(() => {
    subscription = debuggerSession.registerStopDebugger(() => {});
  });
  assert.equal(startDisposals, 1);
  assert.equal(terminationDisposals, 0);

  assert.doesNotThrow(() => subscription.dispose());
  assert.doesNotThrow(() => subscription.dispose());
  assert.equal(startDisposals, 1);
  assert.equal(terminationDisposals, 1);
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
