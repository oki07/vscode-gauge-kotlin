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
    this.setTimeout = options.setTimeout || setTimeout;
    this.terminals = [];
    this.disposable = this.register();
  }

  latestTerminal() {
    return this.terminals[this.terminals.length - 1];
  }

  execute(text) {
    if (!this.vscode.window || typeof this.vscode.window.createTerminal !== "function") {
      return undefined;
    }
    this.terminals.push(this.vscode.window.createTerminal(TERMINAL_NAME));
    const terminal = this.latestTerminal();
    if (terminal && typeof terminal.show === "function") {
      terminal.show();
    }
    if (terminal && typeof terminal.sendText === "function") {
      terminal.sendText(text);
    }
    return this.setTimeout(() => {
      if (this.vscode.window && typeof this.vscode.window.showInformationMessage === "function") {
        this.vscode.window.showInformationMessage(RELOAD_MESSAGE);
      }
    }, RELOAD_MESSAGE_DELAY_MS);
  }

  register() {
    if (!this.vscode.commands || typeof this.vscode.commands.registerCommand !== "function") {
      return { dispose() {} };
    }
    return this.vscode.commands.registerCommand(
      EXECUTE_IN_TERMINAL_COMMAND,
      (text) => this.execute(text),
    );
  }

  dispose() {
    if (this.disposable && typeof this.disposable.dispose === "function") {
      this.disposable.dispose();
    }
  }
}

module.exports = {
  EXECUTE_IN_TERMINAL_COMMAND,
  RELOAD_MESSAGE,
  TERMINAL_NAME,
  TerminalProvider,
};
