"use strict";

const nodeOs = require("node:os");
const nodePath = require("node:path");

const GAUGE_CONFIGURATION_SECTION = "gauge";
const GAUGE_EXECUTABLE_PATH_KEY = "executablePath";
const GAUGE_HOME_KEY = "home";

function configuredString(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readConfigurationValue(vscode, key) {
  if (!vscode || !vscode.workspace || typeof vscode.workspace.getConfiguration !== "function") {
    return undefined;
  }
  const configuration = vscode.workspace.getConfiguration(GAUGE_CONFIGURATION_SECTION);
  if (!configuration || typeof configuration.get !== "function") {
    return undefined;
  }
  return configuration.get(key);
}

function readGaugeExtensionSettings(vscode) {
  return {
    executablePath: configuredString(readConfigurationValue(vscode, GAUGE_EXECUTABLE_PATH_KEY)),
    homePath: configuredString(readConfigurationValue(vscode, GAUGE_HOME_KEY)),
  };
}

function configuredGaugeHome(options = {}) {
  return configuredString(options.gaugeHome)
    || configuredString(options.homePath)
    || (options.settings && configuredString(options.settings.homePath))
    || readGaugeExtensionSettings(options.vscode).homePath;
}

function envWithGaugeHome(baseEnv = process.env, options = {}) {
  const gaugeHome = configuredGaugeHome(options);
  if (!gaugeHome) {
    return baseEnv;
  }
  return {
    ...baseEnv,
    GAUGE_HOME: gaugeHome,
  };
}

class GaugeConfig {
  constructor(platform = process.platform, options = {}) {
    this.platform = platform;
    this.env = options.env || process.env;
    this.pathModule = options.pathModule || nodePath;
    this.homeDir = options.homeDir || nodeOs.homedir;
    this.configuredGaugeHome = configuredGaugeHome(options);
  }

  pluginsPath() {
    return this.pathModule.join(this.gaugeHome(), "plugins");
  }

  gaugeHome() {
    if (this.configuredGaugeHome !== undefined) {
      return this.configuredGaugeHome;
    }
    if (this.env.GAUGE_HOME !== undefined) {
      return this.env.GAUGE_HOME;
    }
    if (/win\d+/i.test(this.platform)) {
      return this.pathModule.join(this.env.APPDATA, "Gauge");
    }
    return this.pathModule.join(this.homeDir(), ".gauge");
  }
}

module.exports = {
  GaugeConfig,
  envWithGaugeHome,
  readGaugeExtensionSettings,
};
