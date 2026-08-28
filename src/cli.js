"use strict";

const childProcess = require("node:child_process");
const { envWithGaugeHome, readGaugeExtensionSettings } = require("./config/gaugeConfig");
const { OutputChannel } = require("./execution/outputChannel");

const GAUGE_COMMAND = "gauge";
const GAUGE_VERSION_ARG = "--version";
const MACHINE_READABLE_ARG = "--machine-readable";
const GAUGE_INSTALL_ARG = "install";
const MAVEN_COMMAND = "mvn";
const MAVEN_VERSION_ARG = "--version";
const GRADLE_WRAPPER_COMMAND = "gradlew";

function parseVersion(version) {
  return String(version || "")
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isNaN(part) ? 0 : part));
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] || 0;
    const rightPart = rightParts[index] || 0;
    if (leftPart > rightPart) {
      return 1;
    }
    if (leftPart < rightPart) {
      return -1;
    }
  }
  return 0;
}

function pluginNameEquals(left, right) {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

function removeDeprecatedOutputLines(output) {
  return String(output || "")
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("[DEPRECATED]"))
    .join("\n");
}

function getVscode(vscode) {
  return vscode || require("vscode");
}

class CLI {
  constructor(command, manifest = {}, mavenCommand, gradleCommand) {
    this.command = command;
    this.maven = mavenCommand;
    this.gradle = gradleCommand;
    this.gaugeVersion = manifest.version;
    this.gaugeCommitHash = manifest.commitHash;
    this.gaugePlugins = manifest.plugins || [];
    this.pluginInstallOperations = new Map();
  }

  static instance(options = {}) {
    const vscode = options.vscode;
    const settings = options.settings || readGaugeExtensionSettings(vscode);
    const versionEnv = envWithGaugeHome(options.env || process.env, { settings, vscode });
    const gaugeCommand = settings.executablePath
      ? this.getConfiguredCommand(
        settings.executablePath,
        [GAUGE_VERSION_ARG],
        { env: versionEnv },
      )
      : this.getCommand(GAUGE_COMMAND);
    const mavenCommand = this.getCommand(MAVEN_COMMAND, [MAVEN_VERSION_ARG]);
    const gradleCommand = this.getGradleCommand();
    if (!gaugeCommand) {
      return new CLI(undefined, {}, mavenCommand, gradleCommand);
    }

    const versionResult = gaugeCommand.spawnSync(
      [GAUGE_VERSION_ARG, MACHINE_READABLE_ARG],
      { env: versionEnv },
    );
    const versionOutput = versionResult.stdout.toString();
    try {
      return new CLI(
        gaugeCommand,
        JSON.parse(removeDeprecatedOutputLines(versionOutput)),
        mavenCommand,
        gradleCommand,
      );
    } catch (_error) {
      getVscode(vscode).window.showErrorMessage(
        `Error fetching Gauge and plugins version information. \n${versionOutput}`,
      );
      return undefined;
    }
  }

  isPluginInstalled(pluginName) {
    return this.gaugePlugins.some((plugin) => pluginNameEquals(plugin.name, pluginName));
  }

  gaugeCommand() {
    return this.command;
  }

  isGaugeInstalled() {
    return Boolean(this.command);
  }

  isGaugeVersionGreaterOrEqual(version) {
    return compareVersions(this.gaugeVersion, version) >= 0;
  }

  getGaugePluginVersion(language) {
    const plugin = this.gaugePlugins.find((entry) => pluginNameEquals(entry.name, language));
    return plugin && plugin.version;
  }

  refreshGaugeVersionManifest(env) {
    if (!this.command || typeof this.command.spawnSync !== "function") {
      return false;
    }
    try {
      const result = this.command.spawnSync(
        [GAUGE_VERSION_ARG, MACHINE_READABLE_ARG],
        { env },
      );
      if (!result || result.error || result.status !== 0) {
        return false;
      }
      const manifest = JSON.parse(removeDeprecatedOutputLines(result.stdout.toString()));
      if (
        !manifest
        || Array.isArray(manifest)
        || typeof manifest.version !== "string"
        || !Array.isArray(manifest.plugins)
      ) {
        return false;
      }
      this.gaugeVersion = manifest.version;
      this.gaugeCommitHash = manifest.commitHash;
      this.gaugePlugins = manifest.plugins;
      return true;
    } catch (_error) {
      return false;
    }
  }

  installGaugeRunner(language, options = {}) {
    const operationKey = String(language || "").toLowerCase();
    const existingOperation = this.pluginInstallOperations.get(operationKey);
    if (existingOperation) {
      return existingOperation;
    }
    let resolveInstallation;
    let rejectInstallation;
    const installation = new Promise((resolve, reject) => {
      resolveInstallation = resolve;
      rejectInstallation = reject;
    });
    this.pluginInstallOperations.set(operationKey, installation);
    const releaseOperation = () => {
      if (this.pluginInstallOperations.get(operationKey) === installation) {
        this.pluginInstallOperations.delete(operationKey);
      }
    };

    try {
      const vscode = getVscode(options.vscode);
      const channel = vscode.window.createOutputChannel("Gauge Install");
      const output = new OutputChannel(channel, `Installing gauge ${language} plugin ...\n`, "", {
        reveal: true,
      });
      const env = envWithGaugeHome(options.env || process.env, { vscode });
      const child = this.command.spawn([GAUGE_INSTALL_ARG, language], { env });
      const onStdout = (chunk) => output.appendOutBuf(chunk.toString());
      const onStderr = (chunk) => output.appendErrBuf(chunk.toString());
      let finished = false;
      let exitCode;
      let exitSignal;
      let processError;
      const cleanup = () => {
        child.stdout.removeListener("data", onStdout);
        child.stderr.removeListener("data", onStderr);
        child.removeListener("error", onError);
        child.removeListener("exit", onExit);
        child.removeListener("close", onClose);
      };
      const finish = (code, error) => {
        if (finished) {
          return;
        }
        finished = true;
        cleanup();
        if (error) {
          output.appendErrBuf(error.message || String(error));
        }
        if (code === 0) {
          this.refreshGaugeVersionManifest(env);
        }
        try {
          output.onFinish(
            (result) => {
              releaseOperation();
              resolveInstallation(result);
            },
            code,
            "",
            "\nRefer to https://docs.gauge.org/plugin.html to install manually",
            false,
          );
        } catch (finishError) {
          releaseOperation();
          rejectInstallation(finishError);
        }
      };
      const onError = (error) => {
        if (!processError) {
          processError = error;
        }
      };
      const onExit = (code, signal) => {
        exitCode = code;
        exitSignal = signal;
      };
      const onClose = (code, signal) => finish(
        processError || signal || exitSignal ? 1 : (code ?? exitCode ?? 1),
        processError,
      );
      child.stdout.on("data", onStdout);
      child.stderr.on("data", onStderr);
      child.on("error", onError);
      child.on("exit", onExit);
      child.on("close", onClose);
    } catch (error) {
      releaseOperation();
      rejectInstallation(error);
    }
    return installation;
  }

  mavenCommand() {
    return this.maven;
  }

  gradleCommand() {
    return this.gradle;
  }

  gaugeVersionString() {
    const version = `Gauge version: ${this.gaugeVersion}`;
    const commitHash = this.gaugeCommitHash ? `Commit Hash: ${this.gaugeCommitHash}` : "";
    const plugins = this.gaugePlugins
      .map((plugin) => `${plugin.name} (${plugin.version})`)
      .join("\n");
    return `${version}\n${commitHash}\n\nPlugins\n-------\n${plugins}`;
  }

  static getCommandCandidates(command) {
    if (process.platform === "win32") {
      return [
        new Command(command, ".exe"),
        new Command(command, ".bat", true),
        new Command(command, ".cmd", true),
      ];
    }
    return [new Command(command)];
  }

  static isSpawnable(command, testArgs = [], options = {}) {
    const result = command.spawnSync(testArgs, options);
    return result.status === 0 && !result.error;
  }

  static getCommand(command, testArgs = [], options = {}) {
    return this.getCommandCandidates(command)
      .find((candidate) => this.isSpawnable(candidate, testArgs, options));
  }

  static getConfiguredCommand(command, testArgs = [], options = {}) {
    const shellMode = process.platform === "win32" && /\.(?:bat|cmd)$/i.test(command);
    const candidate = new Command(command, "", shellMode);
    return this.isSpawnable(candidate, testArgs, options) ? candidate : undefined;
  }

  static getGradleCommand() {
    if (process.platform === "win32") {
      return new Command(GRADLE_WRAPPER_COMMAND, ".bat", true);
    }
    return new Command(`./${GRADLE_WRAPPER_COMMAND}`);
  }
}

class Command {
  constructor(cmdPrefix, cmdSuffix = "", shellMode = false) {
    this.cmdPrefix = cmdPrefix;
    this.cmdSuffix = cmdSuffix;
    this.shellMode = shellMode;
    this.command = `${cmdPrefix}${cmdSuffix}`;
    this.defaultSpawnOptions = shellMode ? { shell: true } : {};
  }

  spawn(args = [], options = {}) {
    return this.processApi().spawn(
      this.commandForSpawnType(),
      this.argsForSpawnType(args),
      { ...options, ...this.defaultSpawnOptions },
    );
  }

  spawnSync(args = [], options = {}) {
    return this.processApi().spawnSync(
      this.commandForSpawnType(),
      this.argsForSpawnType(args),
      { ...options, ...this.defaultSpawnOptions },
    );
  }

  processApi() {
    return this.childProcess || childProcess;
  }

  // With shell: true the shell splits the command line on spaces, so a launcher
  // under a path like "C:\Program Files\..." never spawns unless it is quoted.
  // Arguments were already quoted; the command itself was not.
  commandForSpawnType() {
    if (!this.shellMode || !this.command.includes(" ")) {
      return this.command;
    }
    return `"${this.command}"`;
  }

  argsForSpawnType(args) {
    if (!this.shellMode) {
      return args;
    }
    return args.map((arg) => (arg.includes(" ") ? `"${arg}"` : arg));
  }
}

module.exports = {
  CLI,
  Command,
};
