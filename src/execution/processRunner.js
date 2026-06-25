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

function createGaugeProcessRunner(options = {}) {
  const vscode = options.vscode || { window: {} };
  const spawn = options.spawn || childProcess.spawn;
  const pathModule = options.pathModule || nodePath;
  const processOutputLine = options.processOutputLine || (() => {});
  const baseEnv = options.env || process.env;
  const outputChannel = options.outputChannel || createDefaultOutputChannel(vscode);

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
        detached: process.platform !== "win32",
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

    run.cancel = function cancel() {
      aborted = true;
      if (child && !child.killed && typeof child.kill === "function") {
        child.kill("SIGTERM");
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
