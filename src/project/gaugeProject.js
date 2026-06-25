"use strict";

const nodePath = require("node:path");

function readManifestLanguage(manifest) {
  return manifest && (manifest.Language || manifest.language || manifest.langauge);
}

function readManifestPlugins(manifest) {
  return (manifest && (manifest.Plugins || manifest.plugins)) || [];
}

class GaugeProject {
  constructor(projectRoot, manifest, options = {}) {
    this.projectRoot = projectRoot;
    this.isGauge = manifest != null;
    this.projectLanguage = readManifestLanguage(manifest);
    this.plugins = readManifestPlugins(manifest);
    this.pathModule = options.pathModule || nodePath;
  }

  getExecutionCommand(cli) {
    return cli.gaugeCommand();
  }

  isGaugeProject() {
    return this.isGauge;
  }

  language() {
    return this.projectLanguage;
  }

  hasFile(filename) {
    if (this.root() === filename) {
      return true;
    }
    const relative = this.pathModule.relative(this.root(), filename);
    return !relative.startsWith("..") && !this.pathModule.isAbsolute(relative);
  }

  isProjectLanguage(language) {
    return this.projectLanguage === language;
  }

  root() {
    return this.projectRoot;
  }

  toString() {
    return `Project Path: ${this.projectRoot}\n`
      + `Language: ${this.projectLanguage}\n`
      + `Plugins:${this.plugins.join(", ")}`;
  }

  equals(other) {
    if (other == null) {
      return false;
    }
    if (!(other instanceof GaugeProject)) {
      return false;
    }
    if (other === this) {
      return true;
    }
    return this.root() === other.root();
  }

  envs() {
    return {};
  }
}

module.exports = {
  GaugeProject,
};
