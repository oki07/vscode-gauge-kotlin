"use strict";

const childProcess = require("node:child_process");
const { GAUGE_CUSTOM_CLASSPATH } = require("./classpath");
const { GaugeProject } = require("./gaugeProject");

function errorOutput(error) {
  if (!error || error.output == null) {
    return String(error && error.message ? error.message : error);
  }
  return error.output.toString();
}

class BuildToolProject extends GaugeProject {
  constructor(projectRoot, manifest, options = {}) {
    super(projectRoot, manifest, options);
    this.execSync = options.execSync || childProcess.execSync;
    this.vscode = options.vscode;
  }

  equals(other) {
    if (other == null) {
      return false;
    }
    if (!(other instanceof this.constructor)) {
      return false;
    }
    if (other === this) {
      return true;
    }
    return this.root() === other.root();
  }

  showClasspathError(error) {
    let vscode = this.vscode;
    if (!vscode) {
      try {
        vscode = require("vscode");
      } catch (_error) {
        return;
      }
    }
    if (vscode.window && typeof vscode.window.showErrorMessage === "function") {
      vscode.window.showErrorMessage(`Error calculating project classpath.\t\n${errorOutput(error)}`);
    }
  }

  classpathFromOutput(output) {
    return output.toString().trim();
  }

  classpathEnv(command, args) {
    if (!command || !command.command) {
      this.showClasspathError(new Error("Build tool command is not available."));
      return undefined;
    }
    try {
      const commandLine = `${command.command} ${args}`;
      const classpath = this.execSync(commandLine, { cwd: this.root() });
      return {
        [GAUGE_CUSTOM_CLASSPATH]: this.classpathFromOutput(classpath),
      };
    } catch (error) {
      this.showClasspathError(error);
      return undefined;
    }
  }
}

module.exports = {
  BuildToolProject,
  GAUGE_CUSTOM_CLASSPATH,
};
