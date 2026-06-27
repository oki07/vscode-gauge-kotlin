"use strict";

const childProcess = require("node:child_process");
const nodePath = require("node:path");
const { OutputChannel } = require("./outputChannel");

const SUCCESS_MESSAGE = "Success: Tests passed.";
const FAILURE_MESSAGE = "Error: Tests failed.";

function createDefaultOutputChannel(vscode) {
  if (vscode.window && typeof vscode.window.createOutputChannel === "function") {
    return vscode.window.createOutputChannel("Gauge Execution");
  }
  return {
    appendLine() {},
    clear() {},
    show() {},
  };
}

function createLineEmitter(callback) {
  let accumulated = "";
  return function emitLines(chunk) {
    const parts = `${accumulated}${chunk.toString()}`.split(/\r?\n/);
    accumulated = parts.pop();
    for (const line of parts) {
      callback(`${line}\n`);
    }
  };
}

function loadProcessTree() {
  try {
    return require("ps-tree");
  } catch {
    return undefined;
  }
}

function normalizePid(pid) {
  const value = Number(pid);
  return Number.isFinite(value) ? value : undefined;
}

function killPid(pid, killProcess) {
  const value = normalizePid(pid);
  if (!value) {
    return;
  }
  try {
    killProcess(value);
  } catch (error) {
    if (!error || error.code !== "ESRCH") {
      throw error;
    }
  }
}

function terminateWindowsProcessTree(child, processTree, killProcess) {
  if (!child || !child.pid) {
    return;
  }
  if (!processTree) {
    killPid(child.pid, killProcess);
    return;
  }
  processTree(child.pid, (error, children) => {
    if (!error && Array.isArray(children)) {
      for (const processInfo of children) {
        killPid(processInfo.PID || processInfo.pid, killProcess);
      }
    }
  });
  killPid(child.pid, killProcess);
}

function terminateNonWindowsProcessTree(child, killProcess) {
  if (!child || !child.pid) {
    return;
  }
  killPid(-child.pid, killProcess);
}

function createGaugeProcessRunner(options = {}) {
  const vscode = options.vscode || { window: {} };
  const spawn = options.spawn || childProcess.spawn;
  const pathModule = options.pathModule || nodePath;
  const processOutputLine = options.processOutputLine || (() => {});
  const baseEnv = options.env || process.env;
  const outputChannel = options.outputChannel || createDefaultOutputChannel(vscode);
  const platform = options.platform || process.platform;
  const processTree = options.processTree || loadProcessTree();
  const killProcess = options.killProcess || process.kill;

  return function runGaugeProcess(command) {
    let child;
    let aborted = false;
    let settle;
    const run = new Promise((resolve) => {
      settle = resolve;
      const initial = ["Running tool:", command.command, command.args.join(" ")].join(" ");
      const channel = new OutputChannel(outputChannel, initial, command.cwd, { pathModule });
      const emitStdoutLine = createLineEmitter((lineText) => {
        channel.appendOutBuf(lineText);
        processOutputLine(lineText);
      });

      child = spawn(command.command, command.args, {
        cwd: command.cwd,
        detached: platform !== "win32",
        env: command.env || baseEnv,
      });
      child.stdout.on("data", emitStdoutLine);
      child.stderr.on("data", (chunk) => channel.appendErrBuf(chunk.toString()));
      child.on("exit", (code) => {
        channel.onFinish(resolve, code, SUCCESS_MESSAGE, FAILURE_MESSAGE, aborted);
      });
      child.on("error", () => {
        channel.onFinish(resolve, 1, SUCCESS_MESSAGE, FAILURE_MESSAGE, aborted);
      });
    });

    run.cancel = function cancel(userAborted = true) {
      aborted = userAborted;
      if (child && !child.killed && platform === "win32") {
        terminateWindowsProcessTree(child, processTree, killProcess);
      } else if (child && !child.killed) {
        terminateNonWindowsProcessTree(child, killProcess);
      } else if (settle) {
        settle(false);
      }
    };

    return run;
  };
}

module.exports = {
  createGaugeProcessRunner,
};
