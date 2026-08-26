"use strict";

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
    this.disposed = false;
    this.disposables = [];

    // Spec and concept files are mapped to their languages by the `languages`
    // contribution in package.json, so no workspace `files.associations` entry
    // is written here. Activation must not create a project `.vscode/settings.json`.
    this.registerCommand();
    this.showRecommendedSettingsNotification();
  }

  configuration() {
    return this.vscode.workspace.getConfiguration();
  }

  inspectConfiguration(key) {
    const configuration = this.configuration();
    if (!configuration || typeof configuration.inspect !== "function") {
      return {};
    }
    return configuration.inspect(key) || {};
  }

  configurationTarget() {
    return this.vscode.ConfigurationTarget || {
      Global: 1,
      Workspace: 2,
    };
  }

  registerCommand() {
    if (this.disposed) {
      return;
    }
    if (!this.vscode.commands || typeof this.vscode.commands.registerCommand !== "function") {
      return;
    }
    const disposable = this.vscode.commands.registerCommand(
      SAVE_RECOMMENDED_SETTINGS,
      () => this.applyAndReload(this.recommendedSettings, this.configurationTarget().Workspace),
    );
    if (this.disposed) {
      if (disposable && typeof disposable.dispose === "function") {
        disposable.dispose();
      }
      return;
    }
    this.disposables.push(disposable);
  }

  verifyRecommendedConfig() {
    if (this.disposed) {
      return true;
    }
    const recommendedOption = this.inspectConfiguration(RECOMMENDED_SETTINGS_OPTION);
    if (this.disposed) {
      return true;
    }
    if (recommendedOption.globalValue === IGNORE) {
      return true;
    }

    for (const key of Object.keys(this.recommendedSettings)) {
      const inspected = this.inspectConfiguration(key);
      if (this.disposed) {
        return true;
      }
      if (!inspected.workspaceFolderValue
        && !inspected.workspaceValue
        && inspected.globalValue !== this.recommendedSettings[key]) {
        return false;
      }
    }
    return true;
  }

  async showRecommendedSettingsNotification() {
    if (this.disposed) {
      return undefined;
    }
    if (this.verifyRecommendedConfig()) {
      return undefined;
    }
    if (this.disposed) {
      return undefined;
    }

    const recommendedOption = this.inspectConfiguration(RECOMMENDED_SETTINGS_OPTION);
    if (this.disposed) {
      return undefined;
    }
    if (recommendedOption.globalValue === APPLY_AND_RELOAD) {
      return this.applyAndReload(
        { ...this.recommendedSettings },
        this.configurationTarget().Workspace,
      );
    }

    if (!this.vscode.window || typeof this.vscode.window.showInformationMessage !== "function") {
      return undefined;
    }

    let selection;
    try {
      selection = this.vscode.window.showInformationMessage(
        "Gauge recommends some settings for best experience with Visual Studio Code.",
        APPLY_AND_RELOAD,
        REMIND_ME_LATER,
        IGNORE,
      );
      if (!selection || typeof selection.then !== "function") {
        return undefined;
      }
      const option = await selection;
      if (this.disposed) {
        return undefined;
      }
      return await this.applySelectedOption(option);
    } catch (error) {
      if (this.disposed) {
        return undefined;
      }
      throw error;
    }
  }

  async applySelectedOption(option) {
    if (this.disposed) {
      return undefined;
    }
    if (option === APPLY_AND_RELOAD) {
      const target = this.configurationTarget();
      if (this.disposed) {
        return undefined;
      }
      this.applyAndReload(this.recommendedSettings, target.Workspace, false);
      if (this.disposed) {
        return undefined;
      }
      return this.applyAndReload(
        { [RECOMMENDED_SETTINGS_OPTION]: APPLY_AND_RELOAD },
        target.Global,
      );
    }
    if (option === IGNORE) {
      const target = this.configurationTarget().Global;
      if (this.disposed) {
        return undefined;
      }
      return this.applyAndReload(
        { [RECOMMENDED_SETTINGS_OPTION]: IGNORE },
        target,
        false,
      );
    }
    if (option === REMIND_ME_LATER) {
      const recommendedOption = this.inspectConfiguration(RECOMMENDED_SETTINGS_OPTION);
      if (this.disposed) {
        return undefined;
      }
      if (recommendedOption.globalValue !== REMIND_ME_LATER) {
        const target = this.configurationTarget().Global;
        if (this.disposed) {
          return undefined;
        }
        return this.applyAndReload(
          { [RECOMMENDED_SETTINGS_OPTION]: REMIND_ME_LATER },
          target,
          false,
        );
      }
    }
    return undefined;
  }

  async applyAndReload(settings, configurationTarget, shouldReload = true) {
    if (this.disposed) {
      return undefined;
    }
    const configuration = this.configuration();
    if (this.disposed) {
      return undefined;
    }
    const updatePromises = [];
    for (const key of Object.keys(settings)) {
      if (this.disposed) {
        break;
      }
      try {
        updatePromises.push(configuration.update(key, settings[key], configurationTarget));
      } catch (error) {
        if (this.disposed) {
          break;
        }
        throw error;
      }
    }
    try {
      await Promise.all(updatePromises);
    } catch (error) {
      if (this.disposed) {
        return undefined;
      }
      throw error;
    }
    if (this.disposed) {
      return undefined;
    }
    if (!shouldReload) {
      return undefined;
    }
    try {
      const result = await this.vscode.commands.executeCommand(RELOAD_WINDOW);
      return this.disposed ? undefined : result;
    } catch (error) {
      if (this.disposed) {
        return undefined;
      }
      throw error;
    }
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const disposables = this.disposables;
    this.disposables = [];
    for (const disposable of disposables) {
      if (disposable && typeof disposable.dispose === "function") {
        disposable.dispose();
      }
    }
  }
}

module.exports = {
  ConfigProvider,
};
