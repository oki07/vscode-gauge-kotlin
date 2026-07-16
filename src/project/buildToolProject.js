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
    this.exec = options.exec || (options.execSync ? undefined : childProcess.exec);
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

  execAsync(commandLine, options) {
    if (typeof this.exec === "function") {
      return new Promise((resolve, reject) => {
        this.exec(commandLine, options, (error, stdout) => (
          error ? reject(error) : resolve(stdout)
        ));
      });
    }
    return new Promise((resolve, reject) => {
      try {
        resolve(this.execSync(commandLine, options));
      } catch (error) {
        reject(error);
      }
    });
  }

  async classpathEnvAsync(command, args) {
    try {
      const classpath = await this.execAsync(`${command.command} ${args}`, { cwd: this.root() });
      return {
        [GAUGE_CUSTOM_CLASSPATH]: this.classpathFromOutput(classpath),
      };
    } catch (error) {
      this.showClasspathError(error);
      return undefined;
    }
  }

  async runBuildCommandAsync(command, args) {
    try {
      await this.execAsync(`${command.command} ${args}`, { cwd: this.root() });
      return true;
    } catch (error) {
      this.showClasspathError(error);
      return false;
    }
  }

  // Compiles per run, but only resolves the build-tool classpath when the
  // caller has no cached value for this root.
  async executionEnvsAsync(cli, cachedEnv) {
    const command = this.executionBuildToolCommand(cli);
    if (!command || !command.command) {
      this.showClasspathError(new Error("Build tool command is not available."));
      return undefined;
    }
    const built = await this.runBuildCommandAsync(command, this.executionBuildArgs());
    if (!built) {
      return undefined;
    }
    if (cachedEnv) {
      return cachedEnv;
    }
    return this.classpathEnvAsync(command, this.executionClasspathArgs());
  }
}

module.exports = {
  BuildToolProject,
  GAUGE_CUSTOM_CLASSPATH,
};
