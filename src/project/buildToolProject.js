"use strict";

const childProcess = require("node:child_process");
const { GAUGE_CUSTOM_CLASSPATH } = require("./classpath");
const { GaugeProject } = require("./gaugeProject");

function errorOutput(error) {
  if (!error || error.output == null) {
    return String(error && error.message ? error.message : error);
  }
  if (Array.isArray(error.output)) {
    const parts = error.output
      .map((part) => (part == null ? "" : part.toString().trim()))
      .filter((part) => part !== "");
    return parts.length > 0 ? parts.join("\n") : String(error.message || error);
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

  // An empty classpath must never reach gauge_custom_classpath: the Gauge
  // Java launcher would silently fall back to a stale or empty gauge_bin and
  // run with no steps or hooks registered.
  classpathEnvFromOutput(output) {
    const classpath = this.classpathFromOutput(output);
    if (!classpath) {
      this.showClasspathError(new Error("The build tool returned an empty classpath."));
      return undefined;
    }
    return {
      [GAUGE_CUSTOM_CLASSPATH]: classpath,
    };
  }

  classpathEnv(command, args) {
    if (!command || !command.command) {
      this.showClasspathError(new Error("Build tool command is not available."));
      return undefined;
    }
    try {
      const commandLine = `${command.command} ${args}`;
      const classpath = this.execSync(commandLine, { cwd: this.root() });
      return this.classpathEnvFromOutput(classpath);
    } catch (error) {
      this.showClasspathError(error);
      return undefined;
    }
  }

  execAsync(commandLine, options) {
    if (typeof this.exec === "function") {
      return new Promise((resolve, reject) => {
        this.exec(commandLine, options, (error, stdout, stderr) => {
          if (!error) {
            resolve(stdout);
            return;
          }
          // Maven and Gradle report failures on stdout, which exec drops from
          // error.message; mirror execSync's error.output so the classpath
          // error toast carries the build tool's actual output.
          if (error.output == null) {
            error.output = [null, stdout, stderr];
          }
          reject(error);
        });
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
      return this.classpathEnvFromOutput(classpath);
    } catch (error) {
      this.showClasspathError(error);
      return undefined;
    }
  }

  buildTask(command, args) {
    const vscode = this.vscode;
    if (
      !vscode
      || !vscode.tasks
      || typeof vscode.tasks.executeTask !== "function"
      || typeof vscode.tasks.onDidEndTaskProcess !== "function"
      || typeof vscode.Task !== "function"
    ) {
      return undefined;
    }

    const options = { cwd: this.root() };
    let execution;
    if (command.shellMode && typeof vscode.ShellExecution === "function") {
      execution = new vscode.ShellExecution(command.command, args, options);
    } else if (typeof vscode.ProcessExecution === "function") {
      execution = new vscode.ProcessExecution(command.command, args, options);
    } else {
      return undefined;
    }

    const task = new vscode.Task(
      { type: "gauge-maven-prepare" },
      vscode.TaskScope.Workspace,
      "test-compile",
      "Maven",
      execution,
    );
    task.presentationOptions = {
      clear: true,
      echo: false,
      focus: false,
      panel: vscode.TaskPanelKind.Dedicated,
      reveal: vscode.TaskRevealKind.Always,
      showReuseMessage: false,
    };
    return task;
  }

  async runBuildTaskAsync(command, args) {
    const task = this.buildTask(command, args);
    if (!task) {
      return undefined;
    }

    return new Promise((resolve, reject) => {
      const subscription = this.vscode.tasks.onDidEndTaskProcess((event) => {
        if (event.execution && event.execution.task === task) {
          subscription.dispose();
          resolve(event.exitCode === 0);
        }
      });
      this.vscode.tasks.executeTask(task).catch((error) => {
        subscription.dispose();
        reject(error);
      });
    });
  }

  async runBuildCommandAsync(command, args) {
    if (typeof this.executionBuildTaskArgs === "function") {
      try {
        const result = await this.runBuildTaskAsync(command, this.executionBuildTaskArgs());
        if (result !== undefined) {
          return result;
        }
      } catch (error) {
        this.showClasspathError(error);
        return false;
      }
    }
    try {
      await this.execAsync(`${command.command} ${args}`, { cwd: this.root() });
      return true;
    } catch (error) {
      this.showClasspathError(error);
      return false;
    }
  }

  // Compiles when the caller has not preserved a valid preparation, and only
  // resolves the build-tool classpath when this root has no cached value.
  async executionEnvsAsync(cli, cachedEnv, options = {}) {
    const command = this.executionBuildToolCommand(cli);
    if (!command || !command.command) {
      this.showClasspathError(new Error("Build tool command is not available."));
      return undefined;
    }
    if (!options.skipBuild) {
      const built = await this.runBuildCommandAsync(command, this.executionBuildArgs());
      if (!built) {
        return undefined;
      }
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
