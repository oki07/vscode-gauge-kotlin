"use strict";

const nodeOs = require("node:os");
const nodePath = require("node:path");
const { GaugeConfig } = require("./config/gaugeConfig");
const { GaugeJavaProjectConfig } = require("./config/gaugeProjectConfig");
const { GaugeClients } = require("./gaugeClients");
const { GaugeWorkspaceFeature } = require("./gaugeWorkspaceFeature");
const { MavenProject } = require("./project/mavenProject");
const { createProjectFactory } = require("./project/projectFactory");

const GAUGE_MULTI_PROJECT_CONTEXT = "gauge:multipleProjects?";
const GAUGE_LAUNCH_CONFIG = "gauge.launch";
const GAUGE_CODELENS_CONFIG = "gauge.codeLenses";
const DEBUG_LOG_LEVEL_CONFIG = "enableDebugLogs";
const REFERENCE_CONFIG = "reference";
const JAVA_RUNNER = "java";

function getVscode(vscode) {
  return vscode || require("vscode");
}

function getLanguageClientModule(options) {
  if (options.LanguageClient) {
    return {
      LanguageClient: options.LanguageClient,
      RevealOutputChannelOn: options.RevealOutputChannelOn,
    };
  }
  return require("vscode-languageclient/node");
}

function createToken(vscode) {
  if (typeof vscode.CancellationTokenSource === "function") {
    return new vscode.CancellationTokenSource().token;
  }
  return undefined;
}

function stateOrMemory(state) {
  if (state) {
    return state;
  }
  let reportPath;
  return {
    setReportPath(nextReportPath) {
      reportPath = nextReportPath;
    },
    getReportPath() {
      return reportPath;
    },
  };
}

function minimalEnv(project, cli, baseEnv) {
  const env = {
    ...baseEnv,
    GAUGE_IGNORE_RUNNER_BUILD_FAILURES: "true",
  };
  return {
    ...env,
    ...(project.envs(cli) || {}),
  };
}

class GaugeWorkspace {
  constructor(options = {}) {
    this.vscode = getVscode(options.vscode);
    this.pathModule = options.pathModule || nodePath;
    this.cli = options.cli;
    this.clientsMap = options.clientsMap || new GaugeClients();
    this.clientLanguageMap = new Map();
    this.env = options.env || process.env;
    this.state = stateOrMemory(options.state);
    this.GaugeWorkspaceFeature = options.GaugeWorkspaceFeature || GaugeWorkspaceFeature;
    this.JavaProjectConfig = options.JavaProjectConfig || GaugeJavaProjectConfig;
    this.platform = options.platform || nodeOs.platform;
    this.gaugeConfigFactory = options.gaugeConfigFactory || (
      (platformName) => new GaugeConfig(platformName, {
        env: this.env,
        pathModule: this.pathModule,
      })
    );
    const languageClientModule = getLanguageClientModule(options);
    this.LanguageClient = languageClientModule.LanguageClient;
    this.revealOutputChannelOnNever = languageClientModule.RevealOutputChannelOn
      ? languageClientModule.RevealOutputChannelOn.Never
      : "never";
    this.projectFactory = options.projectFactory || createProjectFactory({
      execSync: options.execSync,
      fileSystem: options.fileSystem,
      pathModule: this.pathModule,
      vscode: this.vscode,
    });
    this.disposables = [];
    this.registerWorkspaceFolderChanges();
    this.startup = this.startWorkspaceProjects();
  }

  ready() {
    return this.startup;
  }

  dispose() {
    for (const disposable of this.disposables) {
      if (disposable && typeof disposable.dispose === "function") {
        disposable.dispose();
      }
    }
  }

  async startWorkspaceProjects() {
    const folders = this.vscode.workspace.workspaceFolders || [];
    for (const folder of folders) {
      await this.startServerFor(folder.uri.fsPath);
    }
    await this.setMultiProjectContext();
  }

  setReportPath(reportPath) {
    this.state.setReportPath(reportPath.trim());
  }

  getReportPath() {
    return this.state.getReportPath();
  }

  getClientsMap() {
    return this.clientsMap;
  }

  getClientLanguageMap() {
    return this.clientLanguageMap;
  }

  getDefaultFolder() {
    return [...this.clientsMap.keys()].sort((left, right) => (left > right ? 1 : -1))[0];
  }

  async showProjectOptions(onChange) {
    const projectItems = [...this.clientsMap.keys()]
      .sort((left, right) => (left > right ? 1 : -1))
      .map((projectRoot) => ({
        label: this.pathModule.basename(projectRoot),
        description: projectRoot,
      }));
    const selected = await this.vscode.window.showQuickPick(projectItems, {
      canPickMany: false,
      placeHolder: "Choose a project",
    });
    if (!selected) {
      return undefined;
    }
    return onChange(selected.description);
  }

  async setMultiProjectContext() {
    if (this.vscode.commands && typeof this.vscode.commands.executeCommand === "function") {
      await this.vscode.commands.executeCommand(
        "setContext",
        GAUGE_MULTI_PROJECT_CONTEXT,
        this.clientsMap.size > 1,
      );
    }
  }

  registerWorkspaceFolderChanges() {
    if (!this.vscode.workspace || typeof this.vscode.workspace.onDidChangeWorkspaceFolders !== "function") {
      return;
    }
    const disposable = this.vscode.workspace.onDidChangeWorkspaceFolders(
      (event) => this.onWorkspaceFoldersChanged(event),
    );
    if (disposable) {
      this.disposables.push(disposable);
    }
  }

  async onWorkspaceFoldersChanged(event) {
    const added = event && event.added ? event.added : [];
    const removed = event && event.removed ? event.removed : [];
    for (const folder of added) {
      await this.startServerFor(folder.uri.fsPath);
    }
    for (const folder of removed) {
      await this.stopServerFor(folder.uri.fsPath);
    }
    await this.setMultiProjectContext();
  }

  async stopServerFor(folder) {
    const projectClient = this.clientsMap.get(folder);
    if (!projectClient) {
      return;
    }
    this.clientsMap.delete(projectClient.project.root());
    if (projectClient.client && typeof projectClient.client.stop === "function") {
      await projectClient.client.stop();
    }
  }

  serverOptionsFor(project) {
    const command = this.cli.gaugeCommand();
    const args = command.argsForSpawnType(["daemon", "--lsp", "--dir", project.root()]);
    const launchConfig = this.vscode.workspace.getConfiguration(GAUGE_LAUNCH_CONFIG);
    if (launchConfig && launchConfig.get(DEBUG_LOG_LEVEL_CONFIG)) {
      args.push("-l", "debug");
    }

    const env = minimalEnv(project, this.cli, this.env);
    const codeLensConfig = this.vscode.workspace.getConfiguration(GAUGE_CODELENS_CONFIG);
    if (codeLensConfig && codeLensConfig.has(REFERENCE_CONFIG) && !codeLensConfig.get(REFERENCE_CONFIG)) {
      env.gauge_lsp_reference_codelens = "false";
    }

    return {
      command: command.command,
      args,
      options: {
        env,
        ...command.defaultSpawnOptions,
      },
    };
  }

  clientOptionsFor(project, folder) {
    return {
      documentSelector: [
        { scheme: "file", language: "gauge", pattern: `${project.root()}/**/*` },
      ],
      diagnosticCollectionName: "gauge",
      outputChannel: this.vscode.window.createOutputChannel("gauge"),
      revealOutputChannelOn: this.revealOutputChannelOnNever,
      synchronize: {
        configurationSection: "gauge",
      },
      workspaceFolder: this.vscode.workspace.getWorkspaceFolder(this.vscode.Uri.file(folder)),
    };
  }

  async startServerFor(folder) {
    if (!this.projectFactory.isGaugeProject(folder)) {
      return undefined;
    }
    const project = this.projectFactory.get(folder);
    if (this.clientsMap.has(project.root())) {
      return this.clientsMap.get(project.root()).client;
    }

    await this.installRunnerFor(project);
    this.generateJavaConfig(project);
    const languageClient = new this.LanguageClient(
      "gauge",
      "Gauge",
      this.serverOptionsFor(project),
      this.clientOptionsFor(project, folder),
    );
    this.clientsMap.set(project.root(), { project, client: languageClient });
    this.registerDynamicFeatures(languageClient);
    await languageClient.start();
    await this.setLanguageId(languageClient, project.root());
    return languageClient;
  }

  registerDynamicFeatures(languageClient) {
    if (typeof languageClient.registerFeatures !== "function") {
      return;
    }
    languageClient.registerFeatures([
      new this.GaugeWorkspaceFeature(languageClient, { vscode: this.vscode }),
    ]);
  }

  generateJavaConfig(project) {
    if (!project.isProjectLanguage(JAVA_RUNNER) || !this.cli.isPluginInstalled(JAVA_RUNNER)) {
      return;
    }
    if (!(project instanceof MavenProject)) {
      const gaugeConfig = this.gaugeConfigFactory(this.platform());
      new this.JavaProjectConfig(
        project.root(),
        this.cli.getGaugePluginVersion(JAVA_RUNNER),
        gaugeConfig,
      ).generate();
    }
    this.env.SHOULD_BUILD_PROJECT = "false";
  }

  async installRunnerFor(project) {
    const language = project.language();
    if (!language || this.cli.isPluginInstalled(language)) {
      return undefined;
    }
    const message = `The project ${this.pathModule.basename(project.root())} requires gauge ${language} to be installed. Would you like to install it?`;
    const action = await this.vscode.window.showErrorMessage(message, { modal: true }, "Yes", "No");
    if (action === "Yes") {
      return this.cli.installGaugeRunner(language, { vscode: this.vscode });
    }
    return undefined;
  }

  async setLanguageId(languageClient, projectRoot) {
    const language = await languageClient.sendRequest("gauge/getRunnerLanguage", createToken(this.vscode));
    this.clientLanguageMap.set(projectRoot, language);
  }
}

module.exports = {
  GaugeWorkspace,
};
