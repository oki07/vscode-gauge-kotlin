"use strict";

const childProcess = require("node:child_process");
const nodePath = require("node:path");
const { StringDecoder } = require("node:string_decoder");
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

function createUtf8Emitter(callback) {
  const decoder = new StringDecoder("utf8");
  let finished = false;
  return {
    write(chunk) {
      if (finished) {
        return;
      }
      const value = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      const text = decoder.write(value);
      if (text) {
        callback(text);
      }
    },
    finish() {
      if (finished) {
        return;
      }
      finished = true;
      const text = decoder.end();
      if (text) {
        callback(text);
      }
    },
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
  const processStarted = options.processStarted || (() => {});
  const processOutputLine = options.processOutputLine || (() => {});
  const processOutputChunk = options.processOutputChunk || (() => {});
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
      // Gauge reveals its execution channel on every run. Runs that forward
      // their output to the Test Results panel keep it hidden so the test UI
      // stays in front.
      const channel = new OutputChannel(outputChannel, initial, command.cwd, {
        pathModule,
        reveal: command.forwardOutput !== true,
      });
      const machineReadable = isMachineReadableCommand(command);
      const emitStdoutLine = createLineEmitter((lineText) => {
        if (machineReadable) {
          appendMachineReadableOutput(channel, lineText);
        } else {
          channel.appendOutBuf(lineText);
        }
        processOutputLine(lineText);
      });
      const emitStdoutChunk = createUtf8Emitter(processOutputChunk);
      const emitStderrChunk = createUtf8Emitter(processOutputChunk);
      const finishOutputChunks = () => {
        emitStdoutChunk.finish();
        emitStderrChunk.finish();
      };
      let exitCode;
      let processFinished = false;
      const finishProcess = (code) => {
        if (processFinished) {
          return;
        }
        processFinished = true;
        finishOutputChunks();
        channel.onFinish(resolve, code, SUCCESS_MESSAGE, FAILURE_MESSAGE, aborted);
      };
      const outputStreamsEnded = () => (
        child.stdout.readableEnded !== false
        && child.stderr.readableEnded !== false
      );

      let spawnEnv = command.env ? envWithGaugeHome(command.env, gaugeEnvOptions) : baseEnv;
      if (command.saveExecutionResult) {
        spawnEnv = {
          ...spawnEnv,
          save_execution_result: "true",
        };
      }
      const spawnOptions = {
        cwd: command.cwd,
        detached: platform !== "win32",
        env: spawnEnv,
      };
      child = command.tool && typeof command.tool.spawn === "function"
        ? command.tool.spawn(command.args, spawnOptions)
        : spawn(command.command, command.args, spawnOptions);
      processStarted(command);
      child.stdout.on("data", (chunk) => {
        if (command.forwardOutput) {
          emitStdoutChunk.write(chunk);
        }
        emitStdoutLine(chunk);
      });
      child.stderr.on("data", (chunk) => {
        if (command.forwardOutput) {
          emitStderrChunk.write(chunk);
        }
        channel.appendErrBuf(chunk.toString());
      });
      child.on("exit", (code) => {
        exitCode = code;
        if (outputStreamsEnded()) {
          finishProcess(code);
        }
      });
      child.on("close", (code) => {
        finishProcess(code === null || code === undefined ? exitCode : code);
      });
      child.on("error", () => {
        finishProcess(1);
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
