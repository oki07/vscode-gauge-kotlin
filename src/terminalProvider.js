"use strict";

const EXECUTE_IN_TERMINAL_COMMAND = "gauge.executeIn.terminal";
const TERMINAL_NAME = "gauge install";
const RELOAD_MESSAGE = "Please reload the project after Gauge is installed!";
const RELOAD_MESSAGE_DELAY_MS = 1000;

function getVscode(vscode) {
  return vscode || require("vscode");
}

class TerminalProvider {
  constructor(_context, options = {}) {
    this.vscode = getVscode(options.vscode);
    this.clearTimeout = options.clearTimeout || clearTimeout;
    this.setTimeout = options.setTimeout || setTimeout;
    this.disposed = false;
    this.reloadTimers = new Set();
    this.terminals = [];
    this.disposable = this.register();
  }

  latestTerminal() {
    return this.terminals[this.terminals.length - 1];
  }

  execute(text) {
    if (
      this.disposed ||
      !this.vscode.window ||
      typeof this.vscode.window.createTerminal !== "function"
    ) {
      return undefined;
    }
    const terminal = this.vscode.window.createTerminal(TERMINAL_NAME);
    if (this.disposed) {
      return undefined;
    }
    this.terminals.push(terminal);
    if (terminal && typeof terminal.show === "function") {
      terminal.show();
    }
    if (this.disposed) {
      return undefined;
    }
    if (terminal && typeof terminal.sendText === "function") {
      terminal.sendText(text);
    }
    if (this.disposed) {
      return undefined;
    }
    let handle;
    let fired = false;
    const callback = () => {
      fired = true;
      if (handle !== undefined) {
        this.reloadTimers.delete(handle);
      }
      if (this.disposed) {
        return undefined;
      }
      if (this.vscode.window && typeof this.vscode.window.showInformationMessage === "function") {
        return this.vscode.window.showInformationMessage(RELOAD_MESSAGE);
      }
      return undefined;
    };
    handle = this.setTimeout(callback, RELOAD_MESSAGE_DELAY_MS);
    if (!fired && handle !== undefined) {
      if (this.disposed) {
        this.clearTimeout(handle);
      } else {
        this.reloadTimers.add(handle);
      }
    }
    return handle;
  }

  register() {
    if (this.disposed) {
      return { dispose() {} };
    }
    if (!this.vscode.commands || typeof this.vscode.commands.registerCommand !== "function") {
      return { dispose() {} };
    }
    return this.vscode.commands.registerCommand(
      EXECUTE_IN_TERMINAL_COMMAND,
      (text) => this.execute(text),
    );
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const handle of [...this.reloadTimers]) {
      if (this.reloadTimers.delete(handle)) {
        this.clearTimeout(handle);
      }
    }
    this.terminals.length = 0;
    if (this.disposable && typeof this.disposable.dispose === "function") {
      this.disposable.dispose();
    }
    this.disposable = undefined;
  }
}

module.exports = {
  EXECUTE_IN_TERMINAL_COMMAND,
  RELOAD_MESSAGE,
  TERMINAL_NAME,
  TerminalProvider,
};
