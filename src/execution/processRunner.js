"use strict";

const childProcess = require("node:child_process");
const nodePath = require("node:path");
const { envWithGaugeHome } = require("../config/gaugeConfig");
const { parseMachineReadableEvent } = require("./lineProcessors");
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

function isMachineReadableCommand(command) {
  return Array.isArray(command && command.args)
    && command.args.some((arg) => String(arg).includes("--machine-readable"));
}

function textWithLine(value) {
  if (!value) {
    return "";
  }
  return value.endsWith("\n") ? value : `${value}\n`;
}

function appendMachineReadableOutput(channel, lineText) {
  const event = parseMachineReadableEvent(lineText);
  if (!event) {
    channel.appendOutBuf(lineText);
    return;
  }
  if (String(event.type || "").toLowerCase() === "out") {
    const message = textWithLine(event.message || "");
    if (message) {
      channel.appendOutBuf(message);
    }
  }
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
  const gaugeEnvOptions = { vscode, gaugeHome: options.gaugeHome };
  const baseEnv = envWithGaugeHome(options.env || process.env, gaugeEnvOptions);
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
      const displayArgs = command.tool && typeof command.tool.argsForSpawnType === "function"
        ? command.tool.argsForSpawnType(command.args)
        : command.args;
      const initial = ["Running tool:", command.command, displayArgs.join(" ")].join(" ");
      const channel = new OutputChannel(outputChannel, initial, command.cwd, { pathModule });
      const machineReadable = isMachineReadableCommand(command);
      const emitStdoutLine = createLineEmitter((lineText) => {
        if (machineReadable) {
          appendMachineReadableOutput(channel, lineText);
        } else {
          channel.appendOutBuf(lineText);
        }
        processOutputLine(lineText);
      });

      const spawnOptions = {
        cwd: command.cwd,
        detached: platform !== "win32",
        env: command.env ? envWithGaugeHome(command.env, gaugeEnvOptions) : baseEnv,
      };
      child = command.tool && typeof command.tool.spawn === "function"
        ? command.tool.spawn(command.args, spawnOptions)
        : spawn(command.command, command.args, spawnOptions);
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
