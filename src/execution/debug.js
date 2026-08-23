"use strict";

const DEBUGGER_NAME = "Gauge Debugger";
const REQUEST_TYPE = "attach";
const DEFAULT_DEBUG_PORT = 9229;
const DEFAULT_DEBUG_START_DELAY_MS = 100;
const DEFAULT_DEBUG_ATTACH_RETRY_DELAY_MS = 5000;
const DEFAULT_DEBUG_ATTACH_TIMEOUT_MS = 25000;
const DEBUG_SESSION_OWNER_KEY = "__gaugeExecutionId";

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
    vscode = vscode || require("vscode");
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(projectRoot));
    if (!folder) {
      throw new Error(`The debugger does not work for a stand alone file. Please open the folder ${projectRoot}.`);
    }
    await sleepProvider(debugStartDelayMs);
    const maxAttempts = debugAttachAttempts(debugAttachTimeoutMs, debugAttachRetryDelayMs);
    const configuration = {
      ...getDebuggerConfiguration(),
      [DEBUG_SESSION_OWNER_KEY]: debugSessionId,
    };
    let lastError;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (attempt > 0) {
        await sleepProvider(debugAttachRetryDelayMs);
      }
      try {
        const started = await vscode.debug.startDebugging(folder, configuration);
        if (started) {
          if (!debugSession && ownsDebugSession(vscode.debug.activeDebugSession)) {
            debugSession = vscode.debug.activeDebugSession;
          }
          return started;
        }
        lastError = new Error("VS Code did not start the debugger.");
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  function registerStopDebugger(callback) {
    vscode = vscode || require("vscode");
    if (!vscode.debug) {
      return undefined;
    }
    let startSubscription;
    let terminationSubscription;
    if (typeof vscode.debug.onDidStartDebugSession === "function") {
      startSubscription = vscode.debug.onDidStartDebugSession((session) => {
        if (!ownsDebugSession(session)) {
          return;
        }
        debugSession = session;
        startSubscription.dispose();
        startSubscription = undefined;
      });
    }
    if (typeof vscode.debug.onDidTerminateDebugSession === "function") {
      terminationSubscription = vscode.debug.onDidTerminateDebugSession((session) => {
        if (!isOwnedDebugSession(session)) {
          return;
        }
        debugSession = undefined;
        callback(session);
      });
    }
    if (!startSubscription && !terminationSubscription) {
      return undefined;
    }
    return {
      dispose() {
        if (startSubscription) {
          startSubscription.dispose();
          startSubscription = undefined;
        }
        if (terminationSubscription) {
          terminationSubscription.dispose();
          terminationSubscription = undefined;
        }
      },
    };
  }

  function stopDebugger() {
    if (!vscode || !vscode.debug || !debugSession) {
      return undefined;
    }
    if (typeof vscode.debug.stopDebugging === "function") {
      return vscode.debug.stopDebugging(debugSession);
    }
    if (typeof debugSession.customRequest === "function") {
      return debugSession.customRequest("disconnect");
    }
    return undefined;
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
