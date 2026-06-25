"use strict";

const FILE_ASSOCIATIONS_KEY = "files.associations";
const SAVE_RECOMMENDED_SETTINGS = "gauge.config.saveRecommended";
const RELOAD_WINDOW = "workbench.action.reloadWindow";
const RECOMMENDED_SETTINGS_OPTION = "gauge.recommendedSettings.options";
const APPLY_AND_RELOAD = "Apply & Reload";
const REMIND_ME_LATER = "Remind me later";
const IGNORE = "Ignore";

function getVscode(vscode) {
  return vscode || require("vscode");
}

class ConfigProvider {
  constructor(context, options = {}) {
    this.context = context;
    this.vscode = getVscode(options.vscode);
    this.recommendedSettings = options.recommendedSettings || {
      "files.autoSave": "afterDelay",
      "files.autoSaveDelay": 500,
    };
    this.disposables = [];

    this.applyDefaultSettings();
    this.registerCommand();
    this.showRecommendedSettingsNotification();
  }

  configuration() {
    return this.vscode.workspace.getConfiguration();
  }

  configurationTarget() {
    return this.vscode.ConfigurationTarget || {
      Global: 1,
      Workspace: 2,
    };
  }

  registerCommand() {
    if (!this.vscode.commands || typeof this.vscode.commands.registerCommand !== "function") {
      return;
    }
    this.disposables.push(
      this.vscode.commands.registerCommand(
        SAVE_RECOMMENDED_SETTINGS,
        () => this.applyAndReload(this.recommendedSettings, this.configurationTarget().Workspace),
      ),
    );
  }

  applyDefaultSettings() {
    const configuration = this.configuration();
    const inspected = configuration.inspect(FILE_ASSOCIATIONS_KEY) || {};
    const associations = {
      ...(inspected.workspaceValue || {}),
      "*.spec": "gauge",
      "*.cpt": "gauge",
    };
    return configuration.update(
      FILE_ASSOCIATIONS_KEY,
      associations,
      this.configurationTarget().Workspace,
    );
  }

  verifyRecommendedConfig() {
    const recommendedOption = this.configuration().inspect(RECOMMENDED_SETTINGS_OPTION) || {};
    if (recommendedOption.globalValue === IGNORE) {
      return true;
    }

    for (const key of Object.keys(this.recommendedSettings)) {
      const inspected = this.configuration().inspect(key) || {};
      if (!inspected.workspaceFolderValue
        && !inspected.workspaceValue
        && inspected.globalValue !== this.recommendedSettings[key]) {
        return false;
      }
    }
    return true;
  }

  showRecommendedSettingsNotification() {
    if (this.verifyRecommendedConfig()) {
      return undefined;
    }

    const recommendedOption = this.configuration().inspect(RECOMMENDED_SETTINGS_OPTION) || {};
    if (recommendedOption.globalValue === APPLY_AND_RELOAD) {
      return this.applyAndReload(
        { ...this.recommendedSettings },
        this.configurationTarget().Workspace,
      );
    }

    if (!this.vscode.window || typeof this.vscode.window.showInformationMessage !== "function") {
      return undefined;
    }

    return this.vscode.window.showInformationMessage(
      "Gauge recommends some settings for best experience with Visual Studio Code.",
      APPLY_AND_RELOAD,
      REMIND_ME_LATER,
      IGNORE,
    ).then((option) => this.applySelectedOption(option));
  }

  applySelectedOption(option) {
    if (option === APPLY_AND_RELOAD) {
      this.applyAndReload(this.recommendedSettings, this.configurationTarget().Workspace, false);
      return this.applyAndReload(
        { [RECOMMENDED_SETTINGS_OPTION]: APPLY_AND_RELOAD },
        this.configurationTarget().Global,
      );
    }
    if (option === IGNORE) {
      return this.applyAndReload(
        { [RECOMMENDED_SETTINGS_OPTION]: IGNORE },
        this.configurationTarget().Global,
        false,
      );
    }
    if (option === REMIND_ME_LATER) {
      const recommendedOption = this.configuration().inspect(RECOMMENDED_SETTINGS_OPTION) || {};
      if (recommendedOption.globalValue !== REMIND_ME_LATER) {
        return this.applyAndReload(
          { [RECOMMENDED_SETTINGS_OPTION]: REMIND_ME_LATER },
          this.configurationTarget().Global,
          false,
        );
      }
    }
    return undefined;
  }

  applyAndReload(settings, configurationTarget, shouldReload = true) {
    const configuration = this.configuration();
    const updatePromises = Object.keys(settings).map((key) => (
      configuration.update(key, settings[key], configurationTarget)
    ));
    if (!shouldReload) {
      return Promise.all(updatePromises);
    }
    return Promise.all(updatePromises)
      .then(() => this.vscode.commands.executeCommand(RELOAD_WINDOW));
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
  ConfigProvider,
};
