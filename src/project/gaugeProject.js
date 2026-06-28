"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { GaugeConfig } = require("../config/gaugeConfig");
const {
  GAUGE_CUSTOM_CLASSPATH,
  collectJarFiles,
  existingDirectories,
  pathDelimiter,
} = require("./classpath");

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
    this.fileSystem = options.fileSystem || nodeFs;
    this.pathModule = options.pathModule || nodePath;
    this.classpathDelimiter = options.pathDelimiter || pathDelimiter(this.pathModule);
    this.gaugeConfig = options.gaugeConfig || (
      options.gaugeConfigFactory
        ? options.gaugeConfigFactory()
        : new GaugeConfig(process.platform, {
          env: options.env || process.env,
          pathModule: this.pathModule,
        })
    );
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

  standardClasspathEntries() {
    const projectName = this.pathModule.basename(this.root());
    return existingDirectories(this.fileSystem, this.pathModule, this.root(), [
      "src/test/kotlin",
      "src/test/java",
      "out/test/" + projectName,
      "out/production/" + projectName,
      "gauge_bin",
    ]);
  }

  projectLibClasspathEntries() {
    return collectJarFiles(
      this.fileSystem,
      this.pathModule,
      this.pathModule.join(this.root(), "libs"),
    );
  }

  gaugePluginClasspathEntries(cli) {
    const language = this.language();
    if (!language || !cli || typeof cli.getGaugePluginVersion !== "function") {
      return [];
    }
    const version = cli.getGaugePluginVersion(language);
    if (!version || !this.gaugeConfig || typeof this.gaugeConfig.pluginsPath !== "function") {
      return [];
    }
    return collectJarFiles(
      this.fileSystem,
      this.pathModule,
      this.pathModule.join(this.gaugeConfig.pluginsPath(), language, version, "libs"),
    );
  }

  classpath(cli) {
    const entries = [
      ...this.standardClasspathEntries(),
      ...this.projectLibClasspathEntries(),
      ...this.gaugePluginClasspathEntries(cli),
    ];
    return entries.join(this.classpathDelimiter);
  }

  envs(cli) {
    const classpath = this.classpath(cli);
    if (!classpath) {
      return {};
    }
    return {
      [GAUGE_CUSTOM_CLASSPATH]: classpath,
    };
  }
}

module.exports = {
  GaugeProject,
};
