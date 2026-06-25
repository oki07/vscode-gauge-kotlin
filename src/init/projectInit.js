"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");

const CREATE_PROJECT_COMMAND = "gauge.createProject";
const GAUGE_INIT_ARG = "init";
const OPEN_FOLDER_COMMAND = "vscode.openFolder";
const TEMPLATE_LIST_ARGS = ["template", "--list", "--machine-readable"];
const INSTALL_INSTRUCTION_URI = "https://docs.gauge.org/getting_started/installing-gauge.html";
const KOTLIN_TEMPLATE_CONFIGURATION = "gauge.kotlin";
const TEMPLATE_CONFIGURATION_KEY = "template";

function getVscode(vscode) {
  return vscode || require("vscode");
}

function removeDirectory(fileSystem, dirname) {
  if (typeof fileSystem.removeSync === "function") {
    fileSystem.removeSync(dirname);
    return;
  }
  if (typeof fileSystem.rmSync === "function") {
    fileSystem.rmSync(dirname, { recursive: true, force: true });
  }
}

function templateText(template) {
  return [
    template.label,
    template.description,
    template.value,
  ].filter(Boolean).join(" ").toLowerCase();
}

function templateScore(template, preferredBuildTool) {
  const text = templateText(template);
  if (!text.includes("kotlin")) {
    return 0;
  }
  if (preferredBuildTool && text.includes(preferredBuildTool)) {
    return 2;
  }
  return 1;
}

class ProgressHandler {
  constructor(vscode, progress, resolve, reject) {
    this.vscode = vscode;
    this.progress = progress;
    this.resolve = resolve;
    this.reject = reject;
  }

  report(message) {
    this.progress.report({ message });
  }

  end(uri) {
    this.resolve();
    return this.vscode.commands.executeCommand(
      OPEN_FOLDER_COMMAND,
      uri,
      Boolean(this.vscode.workspace && this.vscode.workspace.workspaceFolders),
    );
  }

  cancel(message) {
    this.reject(String(message));
  }
}

class ProjectInitializer {
  constructor(options = {}) {
    this.vscode = getVscode(options.vscode);
    this.pathModule = options.pathModule || nodePath;
    this.fileSystem = options.fileSystem || nodeFs;
    this.env = options.env || process.env;
    this.cli = options.cli;
    this.createCli = options.createCli;
    this.disposables = [];
    this.registerCommand();
  }

  registerCommand() {
    if (!this.vscode.commands || typeof this.vscode.commands.registerCommand !== "function") {
      return;
    }
    this.disposables.push(
      this.vscode.commands.registerCommand(CREATE_PROJECT_COMMAND, () => this.createProject()),
    );
  }

  getCli() {
    if (!this.cli && this.createCli) {
      this.cli = this.createCli({ vscode: this.vscode });
    }
    return this.cli;
  }

  async createProject() {
    const cli = this.getCli();
    if (!cli || !cli.isGaugeInstalled()) {
      return this.vscode.window.showErrorMessage(
        `Please install gauge to create a new Gauge project. For more info please refer the [install instructions](${INSTALL_INSTRUCTION_URI}).`,
      );
    }

    const template = await this.vscode.window.showQuickPick(await this.getTemplatesList(cli));
    if (!template) {
      return undefined;
    }
    const folders = await this.getTargetFolder();
    if (!folders) {
      return undefined;
    }
    const name = await this.vscode.window.showInputBox({
      prompt: "Enter a name for your new project",
      placeHolder: "gauge-tests",
    });
    if (!name) {
      return undefined;
    }

    const projectFolderUri = this.vscode.Uri.file(this.pathModule.join(folders[0].fsPath, name));
    if (this.fileSystem.existsSync(projectFolderUri.fsPath)) {
      return this.handleError(
        null,
        `A folder named ${name} already exists in ${folders[0].fsPath}`,
        projectFolderUri.fsPath,
        false,
      );
    }
    this.fileSystem.mkdirSync(projectFolderUri.fsPath);
    return this.createProjectInDir(cli, template, projectFolderUri);
  }

  getTargetFolder() {
    return this.vscode.window.showOpenDialog({
      canSelectFolders: true,
      openLabel: "Select a folder to create the project in",
      canSelectMany: false,
    });
  }

  getPreferredKotlinTemplate() {
    if (!this.vscode.workspace || typeof this.vscode.workspace.getConfiguration !== "function") {
      return undefined;
    }
    const configuration = this.vscode.workspace.getConfiguration(KOTLIN_TEMPLATE_CONFIGURATION);
    if (!configuration || typeof configuration.get !== "function") {
      return undefined;
    }
    const value = configuration.get(TEMPLATE_CONFIGURATION_KEY);
    if (typeof value !== "string") {
      return undefined;
    }
    const normalized = value.trim().toLowerCase();
    return normalized || undefined;
  }

  sortTemplatesByPreference(templates) {
    const preferredBuildTool = this.getPreferredKotlinTemplate();
    if (!preferredBuildTool) {
      return templates;
    }
    return templates.slice().sort((left, right) => (
      templateScore(right, preferredBuildTool) - templateScore(left, preferredBuildTool)
    ));
  }

  createProjectInDir(cli, template, projectFolder) {
    const runner = (progress) => new Promise((resolve, reject) => {
      const progressHandler = new ProgressHandler(this.vscode, progress, resolve, reject);
      this.createFromCommandLine(cli, template, projectFolder, progressHandler);
    });
    if (this.vscode.window && typeof this.vscode.window.withProgress === "function") {
      return this.vscode.window.withProgress({ location: 10 }, runner);
    }
    return runner({ report() {} });
  }

  createFromCommandLine(cli, template, projectFolder, progressHandler) {
    const command = cli.gaugeCommand();
    progressHandler.report("Initializing project...");
    let finished = false;
    const fail = (message) => {
      if (finished) {
        return;
      }
      finished = true;
      this.handleError(
        progressHandler,
        message,
        projectFolder.fsPath,
      );
    };
    const child = command.spawn([GAUGE_INIT_ARG, template.label], {
      cwd: projectFolder.fsPath,
      env: this.env,
    });
    child.addListener("error", (error) => {
      fail(`Failed to create template. ${error.message}`);
    });
    if (child.stdout && typeof child.stdout.on === "function") {
      child.stdout.on("data", () => {});
    }
    child.on("close", (code) => {
      if (finished) {
        return;
      }
      if (code !== 0) {
        fail("Failed to initialize project.");
        return;
      }
      finished = true;
      progressHandler.end(projectFolder);
    });
  }

  async getTemplatesList(cli) {
    const result = cli.gaugeCommand().spawnSync(TEMPLATE_LIST_ARGS, { env: this.env });
    try {
      const templates = JSON.parse(result.stdout.toString()).map((template) => ({
        label: template.key,
        description: template.Description,
        value: template.value,
      }));
      return this.sortTemplatesByPreference(templates);
    } catch (_error) {
      await this.vscode.window.showErrorMessage(
        "Failed to get list of templates.",
        " Try running 'gauge template --list ----machine-readable' from command line",
      );
      return [];
    }
  }

  handleError(progressHandler, error, dirname, removeDir = true) {
    if (removeDir) {
      removeDirectory(this.fileSystem, dirname);
    }
    if (progressHandler) {
      progressHandler.cancel(error);
    }
    return this.vscode.window.showErrorMessage(error);
  }

  dispose() {
    for (const disposable of this.disposables) {
      if (disposable && typeof disposable.dispose === "function") {
        disposable.dispose();
      }
    }
  }
}

module.exports = {
  ProjectInitializer,
};
