"use strict";

const DEBUGGER_NAME = "Gauge Debugger";
const REQUEST_TYPE = "attach";
const DEFAULT_DEBUG_PORT = 9229;
const DEFAULT_DEBUG_START_DELAY_MS = 100;
const DEFAULT_DEBUG_ATTACH_RETRY_DELAY_MS = 5000;
const DEFAULT_DEBUG_ATTACH_TIMEOUT_MS = 25000;

function javaLike(language) {
  return language === "java" || language === "kotlin";
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
  let debugPort = options.debugPort;
  let processId;

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

    return debugEnv;
  }

  function addProcessId(pid) {
    processId = pid;
  }

  function getDebuggerConfiguration() {
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

  async function startDebugger() {
    vscode = vscode || require("vscode");
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(projectRoot));
    if (!folder) {
      throw new Error(`The debugger does not work for a stand alone file. Please open the folder ${projectRoot}.`);
    }
    await sleepProvider(debugStartDelayMs);
    const maxAttempts = debugAttachAttempts(debugAttachTimeoutMs, debugAttachRetryDelayMs);
    let lastError;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (attempt > 0) {
        await sleepProvider(debugAttachRetryDelayMs);
      }
      try {
        const started = await vscode.debug.startDebugging(folder, getDebuggerConfiguration());
        if (started) {
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
    if (!vscode.debug || typeof vscode.debug.onDidTerminateDebugSession !== "function") {
      return undefined;
    }
    return vscode.debug.onDidTerminateDebugSession((session) => {
      callback(session);
    });
  }

  function stopDebugger() {
    if (vscode && vscode.debug && vscode.debug.activeDebugSession) {
      return vscode.debug.activeDebugSession.customRequest("disconnect");
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
