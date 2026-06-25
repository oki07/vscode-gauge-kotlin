"use strict";

const nodeOs = require("node:os");
const nodePath = require("node:path");

class GaugeConfig {
  constructor(platform = process.platform, options = {}) {
    this.platform = platform;
    this.env = options.env || process.env;
    this.pathModule = options.pathModule || nodePath;
    this.homeDir = options.homeDir || nodeOs.homedir;
  }

  pluginsPath() {
    return this.pathModule.join(this.gaugeHome(), "plugins");
  }

  gaugeHome() {
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
};
