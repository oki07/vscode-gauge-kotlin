"use strict";

const DEBUGGER_NAME = "Gauge Debugger";
const REQUEST_TYPE = "attach";
const DEFAULT_DEBUG_PORT = 9229;
const DEFAULT_DEBUG_START_DELAY_MS = 100;
const DEFAULT_DEBUG_ATTACH_RETRY_DELAY_MS = 5000;
const DEFAULT_DEBUG_ATTACH_TIMEOUT_MS = 25000;
const DEBUG_SESSION_OWNER_KEY = "__gaugeExecutionId";
const CANCELLED_DEBUG_ATTACH = Symbol("cancelledDebugAttach");

let nextDebugSessionId = 0;

function javaLike(language) {
  return language === "java" || language === "kotlin";
}

function csharpLike(language) {
  return language === "csharp" || language === "dotnet";
}

function getConfiguredDebugPort(vscode) {
  if (!vscode || !vscode.workspace || typeof vscode.workspace.getConfiguration !== "function") {
    return DEFAULT_DEBUG_PORT;
  }

  const configuration = vscode.workspace.getConfiguration("gauge");
  if (!configuration || typeof configuration.get !== "function") {
    return DEFAULT_DEBUG_PORT;
  }

  const value = configuration.get("execution.debugPort");
  return Number.isInteger(value) ? value : DEFAULT_DEBUG_PORT;
}

async function loadGetPort() {
  try {
    const module = await import("get-port");
    return module.default || module;
  } catch {
    return ({ port }) => port;
  }
}

async function resolveDebugPort(preferredPort, getPort) {
  const portResolver = getPort || await loadGetPort();
  return portResolver({ port: preferredPort });
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function debugAttachAttempts(timeoutMs, retryDelayMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return 1;
  }
  if (!Number.isFinite(retryDelayMs) || retryDelayMs <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(timeoutMs / retryDelayMs));
}

function workspaceFolderUri(vscode, projectRoot) {
  const folders = vscode && vscode.workspace && vscode.workspace.workspaceFolders;
  if (!Array.isArray(folders)) {
    return undefined;
  }
  const folder = folders.find((entry) => entry && entry.uri && entry.uri.fsPath === projectRoot);
  return folder && folder.uri;
}

function csharpLaunchOptions(vscode, projectRoot) {
  if (!vscode || !vscode.workspace || typeof vscode.workspace.getConfiguration !== "function") {
    return {};
  }
  try {
    const configuration = vscode.workspace.getConfiguration("launch", workspaceFolderUri(vscode, projectRoot));
    const launchConfigurations = configuration
      && typeof configuration.get === "function"
      && configuration.get("configurations");
    const firstConfiguration = Array.isArray(launchConfigurations) ? launchConfigurations[0] : undefined;
    if (!firstConfiguration || typeof firstConfiguration !== "object") {
      return {};
    }
    const options = {};
    if (Object.prototype.hasOwnProperty.call(firstConfiguration, "justMyCode")) {
      options.justMyCode = firstConfiguration.justMyCode;
    }
    if (firstConfiguration.sourceFileMap && typeof firstConfiguration.sourceFileMap === "object") {
      options.sourceFileMap = firstConfiguration.sourceFileMap;
    }
    return options;
  } catch (_error) {
    return {};
  }
}

function createGaugeDebugger(options = {}) {
  let vscode = options.vscode;
  const projectRoot = options.projectRoot;
  const language = options.language || "kotlin";
  const baseEnv = options.baseEnv || process.env;
  const debugPortProvider = options.debugPortProvider;
  const getPort = options.getPort;
  const debugStartDelayMs = options.debugStartDelayMs ?? DEFAULT_DEBUG_START_DELAY_MS;
  const debugAttachRetryDelayMs = options.debugAttachRetryDelayMs ?? DEFAULT_DEBUG_ATTACH_RETRY_DELAY_MS;
  const debugAttachTimeoutMs = options.debugAttachTimeoutMs ?? DEFAULT_DEBUG_ATTACH_TIMEOUT_MS;
  const sleepProvider = options.sleep || sleep;
  const debugSessionId = `gauge-debug-${++nextDebugSessionId}`;
  let debugPort = options.debugPort;
  let debugSession;
  let processId;
  let attachAttempted = false;
  let stopped = false;
  const activeAttachOperations = new Set();
  const stoppedDebugSessionIds = new Set();

  function ownsDebugSession(session) {
    return Boolean(
      session
      && session.configuration
      && session.configuration[DEBUG_SESSION_OWNER_KEY] === debugSessionId,
    );
  }

  function isOwnedDebugSession(session) {
    return Boolean(debugSession && session && session.id === debugSession.id);
  }

  function disposeSafely(disposable) {
    if (!disposable || typeof disposable.dispose !== "function") {
      return;
    }
    try {
      disposable.dispose();
    } catch (_error) {
      // Continue terminal cleanup after host resource failures.
    }
  }

  function observeDetached(callback) {
    try {
      Promise.resolve(callback()).catch(() => undefined);
    } catch (_error) {
      // Detached terminal cleanup must not escape to the completed run.
    }
  }

  function operationIsCurrent(operation) {
    return !stopped && operation.active;
  }

  function createAttachOperation() {
    let resolveCancellation;
    const operation = {
      active: true,
      cancellation: new Promise((resolve) => {
        resolveCancellation = resolve;
      }),
      hostAttachPending: false,
      lateOwnedSession: undefined,
      lateStartSubscription: undefined,
      lateStartSubscriptionClosed: false,
      lateStartSubscriptionRegistered: false,
      resolveCancellation,
    };
    activeAttachOperations.add(operation);
    return operation;
  }

  function finishAttachOperation(operation) {
    operation.active = false;
    activeAttachOperations.delete(operation);
  }

  function disposeLateStartSubscription(operation) {
    operation.lateStartSubscriptionClosed = true;
    const subscription = operation.lateStartSubscription;
    operation.lateStartSubscription = undefined;
    disposeSafely(subscription);
  }

  function stopOwnedDebugSession(session) {
    if (!vscode || !vscode.debug || !session || !ownsDebugSession(session)) {
      return undefined;
    }
    if (debugSession && debugSession.id !== session.id) {
      return undefined;
    }
    debugSession = session;
    if (stoppedDebugSessionIds.has(session.id)) {
      return undefined;
    }
    stoppedDebugSessionIds.add(session.id);
    if (typeof vscode.debug.stopDebugging === "function") {
      return vscode.debug.stopDebugging(session);
    }
    if (typeof session.customRequest === "function") {
      return session.customRequest("disconnect");
    }
    return undefined;
  }

  function stopLateOwnedSession(operation, session) {
    if (!session || !ownsDebugSession(session)) {
      return;
    }
    if (debugSession && debugSession.id !== session.id) {
      return;
    }
    operation.lateOwnedSession = session;
    observeDetached(() => stopOwnedDebugSession(session));
  }

  function registerLateStartSubscription(operation) {
    if (
      operation.lateStartSubscriptionRegistered
      || operation.lateStartSubscriptionClosed
      || !vscode
      || !vscode.debug
      || typeof vscode.debug.onDidStartDebugSession !== "function"
    ) {
      return;
    }
    operation.lateStartSubscriptionRegistered = true;
    let subscription;
    try {
      subscription = vscode.debug.onDidStartDebugSession((session) => {
        if (!ownsDebugSession(session)) {
          return;
        }
        stopLateOwnedSession(operation, session);
        disposeLateStartSubscription(operation);
      });
    } catch (_error) {
      operation.lateStartSubscriptionClosed = true;
      return;
    }
    if (operation.lateStartSubscriptionClosed) {
      disposeSafely(subscription);
      return;
    }
    operation.lateStartSubscription = subscription;
  }

  function cancelAttachOperation(operation) {
    if (!operation.active) {
      return;
    }
    operation.active = false;
    activeAttachOperations.delete(operation);
    if (operation.hostAttachPending) {
      registerLateStartSubscription(operation);
    }
    operation.resolveCancellation(CANCELLED_DEBUG_ATTACH);
  }

  async function waitForAttachBoundary(operation, callback) {
    const observed = Promise.resolve().then(() => {
      if (!operationIsCurrent(operation)) {
        return CANCELLED_DEBUG_ATTACH;
      }
      return callback();
    });
    return Promise.race([observed, operation.cancellation]);
  }

  async function startHostDebugger(operation, folder, configuration) {
    disposeLateStartSubscription(operation);
    operation.lateOwnedSession = undefined;
    operation.lateStartSubscriptionClosed = false;
    operation.lateStartSubscriptionRegistered = false;
    const hostAttach = Promise.resolve().then(() => {
      if (!operationIsCurrent(operation)) {
        return CANCELLED_DEBUG_ATTACH;
      }
      operation.hostAttachPending = true;
      return vscode.debug.startDebugging(folder, configuration);
    });
    const observed = hostAttach.then(
      (started) => {
        operation.hostAttachPending = false;
        if (!operationIsCurrent(operation)) {
          if (started === true) {
            const session = operation.lateOwnedSession
              || (ownsDebugSession(vscode.debug.activeDebugSession)
                ? vscode.debug.activeDebugSession
                : undefined);
            stopLateOwnedSession(operation, session);
          }
          disposeLateStartSubscription(operation);
          return CANCELLED_DEBUG_ATTACH;
        }
        disposeLateStartSubscription(operation);
        return started;
      },
      (error) => {
        operation.hostAttachPending = false;
        disposeLateStartSubscription(operation);
        if (!operationIsCurrent(operation)) {
          return CANCELLED_DEBUG_ATTACH;
        }
        throw error;
      },
    );
    return Promise.race([observed, operation.cancellation]);
  }

  async function addDebugEnv(env = baseEnv) {
    const preferredPort = debugPort || getConfiguredDebugPort(vscode);
    debugPort = debugPortProvider
      ? await debugPortProvider(preferredPort)
      : await resolveDebugPort(preferredPort, getPort);
    const debugEnv = {
      ...env,
      DEBUGGING: true,
      use_nested_specs: "false",
      SHOULD_BUILD_PROJECT: "true",
      DEBUG_PORT: debugPort,
    };

    if (javaLike(language)) {
      debugEnv.GAUGE_DEBUG_OPTS = debugPort;
    }
    if (csharpLike(language)) {
      debugEnv.GAUGE_CSHARP_PROJECT_CONFIG = "Debug";
    }

    return debugEnv;
  }

  function addProcessId(pid) {
    processId = pid;
  }

  function getDebuggerConfiguration() {
    switch (language) {
      case "python":
        return {
          name: DEBUGGER_NAME,
          type: "python",
          request: REQUEST_TYPE,
          port: debugPort,
          localRoot: projectRoot,
        };
      case "javascript":
        return {
          name: DEBUGGER_NAME,
          type: "node",
          request: REQUEST_TYPE,
          port: debugPort,
          protocol: "inspector",
        };
      case "typescript":
        return {
          name: DEBUGGER_NAME,
          type: "node",
          runtimeArgs: ["--nolazy", "-r", "ts-node/register"],
          request: REQUEST_TYPE,
          sourceMaps: true,
          port: debugPort,
          protocol: "inspector",
        };
      case "ruby":
        return {
          name: DEBUGGER_NAME,
          type: "Ruby",
          request: REQUEST_TYPE,
          cwd: projectRoot,
          remoteWorkspaceRoot: projectRoot,
          remoteHost: "127.0.0.1",
          remotePort: debugPort,
        };
      case "csharp":
      case "dotnet":
        return {
          name: DEBUGGER_NAME,
          type: "coreclr",
          request: REQUEST_TYPE,
          processId,
          justMyCode: true,
          sourceFileMap: {},
          ...csharpLaunchOptions(vscode, projectRoot),
        };
      default:
        if (javaLike(language)) {
          return {
            name: DEBUGGER_NAME,
            type: "java",
            request: REQUEST_TYPE,
            hostName: "127.0.0.1",
            port: debugPort,
          };
        }
        return {
          name: DEBUGGER_NAME,
          type: language,
          request: REQUEST_TYPE,
          processId,
          port: debugPort,
        };
    }
  }

  async function startDebugger() {
    if (stopped || attachAttempted) {
      return false;
    }
    attachAttempted = true;
    const operation = createAttachOperation();
    vscode = vscode || require("vscode");
    try {
      const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(projectRoot));
      if (!operationIsCurrent(operation)) {
        return false;
      }
      if (!folder) {
        throw new Error(`The debugger does not work for a stand alone file. Please open the folder ${projectRoot}.`);
      }
      const initialDelay = await waitForAttachBoundary(
        operation,
        () => sleepProvider(debugStartDelayMs),
      );
      if (initialDelay === CANCELLED_DEBUG_ATTACH || !operationIsCurrent(operation)) {
        return false;
      }
      const maxAttempts = debugAttachAttempts(debugAttachTimeoutMs, debugAttachRetryDelayMs);
      const configuration = {
        ...getDebuggerConfiguration(),
        [DEBUG_SESSION_OWNER_KEY]: debugSessionId,
      };
      if (!operationIsCurrent(operation)) {
        return false;
      }
      let lastError;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (attempt > 0) {
          const retryDelay = await waitForAttachBoundary(
            operation,
            () => sleepProvider(debugAttachRetryDelayMs),
          );
          if (retryDelay === CANCELLED_DEBUG_ATTACH || !operationIsCurrent(operation)) {
            return false;
          }
        }
        try {
          const started = await startHostDebugger(operation, folder, configuration);
          if (started === CANCELLED_DEBUG_ATTACH || !operationIsCurrent(operation)) {
            return false;
          }
          if (started) {
            if (!debugSession && ownsDebugSession(vscode.debug.activeDebugSession)) {
              debugSession = vscode.debug.activeDebugSession;
            }
            return started;
          }
          lastError = new Error("VS Code did not start the debugger.");
        } catch (error) {
          if (!operationIsCurrent(operation)) {
            return false;
          }
          lastError = error;
        }
      }
      throw lastError;
    } catch (error) {
      if (!operationIsCurrent(operation)) {
        return false;
      }
      throw error;
    } finally {
      finishAttachOperation(operation);
    }
  }

  function registerStopDebugger(callback) {
    vscode = vscode || require("vscode");
    if (!vscode.debug) {
      return undefined;
    }
    let startSubscription;
    let startSubscriptionClosed = false;
    let terminationSubscription;
    if (typeof vscode.debug.onDidStartDebugSession === "function") {
      let subscription;
      try {
        subscription = vscode.debug.onDidStartDebugSession((session) => {
          if (!ownsDebugSession(session)) {
            return;
          }
          debugSession = session;
          startSubscriptionClosed = true;
          const ownedSubscription = startSubscription;
          startSubscription = undefined;
          disposeSafely(ownedSubscription);
          if (stopped) {
            observeDetached(() => stopOwnedDebugSession(session));
          }
        });
      } catch (error) {
        throw error;
      }
      if (startSubscriptionClosed) {
        disposeSafely(subscription);
      } else {
        startSubscription = subscription;
      }
    }
    if (typeof vscode.debug.onDidTerminateDebugSession === "function") {
      try {
        terminationSubscription = vscode.debug.onDidTerminateDebugSession((session) => {
          if (!isOwnedDebugSession(session)) {
            return;
          }
          debugSession = undefined;
          callback(session);
        });
      } catch (error) {
        const ownedStartSubscription = startSubscription;
        startSubscription = undefined;
        disposeSafely(ownedStartSubscription);
        throw error;
      }
    }
    if (!startSubscription && !terminationSubscription) {
      return undefined;
    }
    return {
      dispose() {
        const ownedStartSubscription = startSubscription;
        const ownedTerminationSubscription = terminationSubscription;
        startSubscription = undefined;
        terminationSubscription = undefined;
        disposeSafely(ownedStartSubscription);
        disposeSafely(ownedTerminationSubscription);
      },
    };
  }

  function stopDebugger() {
    stopped = true;
    for (const operation of [...activeAttachOperations]) {
      cancelAttachOperation(operation);
    }
    if (!debugSession) {
      return undefined;
    }
    return stopOwnedDebugSession(debugSession);
  }

  return {
    addDebugEnv,
    addProcessId,
    getDebuggerConfiguration,
    registerStopDebugger,
    startDebugger,
    stopDebugger,
  };
}

module.exports = {
  createGaugeDebugger,
};
