"use strict";

const childProcess = require("node:child_process");
const nodeFs = require("node:fs");
const nodePath = require("node:path");

const DEFAULT_JAVA_VERSION = "11";

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeJavaVersion(output) {
  const match = /version "([^"]+)"/.exec(String(output || ""))
    || /(\d+(?:\.\d+)*)/.exec(String(output || ""));
  if (!match) {
    return DEFAULT_JAVA_VERSION;
  }
  const version = match[1];
  if (/^\d\./.test(version)) {
    return version.replace(/(\.\d+(\w+)?$)/, "");
  }
  return version.replace(/\.\d+/g, "");
}

function classpathXml(entries) {
  const lines = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<classpath>",
  ];
  for (const entry of entries) {
    lines.push(`  <classpathentry kind="${escapeXml(entry.kind)}" path="${escapeXml(entry.path)}"/>`);
  }
  lines.push("</classpath>", "");
  return lines.join("\n");
}

function projectXml(projectName) {
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<projectDescription>",
    `  <name>${escapeXml(projectName)}</name>`,
    "  <comment></comment>",
    "  <projects></projects>",
    "  <buildSpec>",
    "    <buildCommand>",
    "      <name>org.eclipse.jdt.core.javabuilder</name>",
    "      <arguments></arguments>",
    "    </buildCommand>",
    "  </buildSpec>",
    "  <natures>",
    "    <nature>org.eclipse.jdt.core.javanature</nature>",
    "  </natures>",
    "</projectDescription>",
    "",
  ].join("\n");
}

class GaugeJavaProjectConfig {
  constructor(projectRoot, pluginVersion, gaugeConfig, options = {}) {
    this.projectRoot = projectRoot;
    this.pluginVersion = pluginVersion;
    this.gaugeConfig = gaugeConfig;
    this.fileSystem = options.fileSystem || nodeFs;
    this.pathModule = options.pathModule || nodePath;
    this.exec = options.exec || childProcess.exec;
  }

  generate() {
    this.exec("java -version", (error, stdout, stderr) => {
      const output = stderr || stdout;
      const javaVersion = error || !output
        ? DEFAULT_JAVA_VERSION
        : normalizeJavaVersion(output);
      this.createDotClassPathFile(
        this.pathModule.join(this.projectRoot, ".classpath"),
        javaVersion,
      );
    });
    this.createDotProjectFile(this.pathModule.join(this.projectRoot, ".project"));
  }

  defaultClassPath(javaVersion) {
    return [
      {
        kind: "con",
        path: "org.eclipse.jdt.launching.JRE_CONTAINER/"
          + `org.eclipse.jdt.internal.debug.ui.launcher.StandardVMType/JavaSE-${javaVersion}`,
      },
      { kind: "src", path: "src/test/java" },
      { kind: "output", path: "gauge_bin" },
    ];
  }

  createDotClassPathFile(classPathFile, javaVersion) {
    const javaPluginPath = this.pathModule.join(this.gaugeConfig.pluginsPath(), "java");
    const libsPath = this.pathModule.join(javaPluginPath, this.pluginVersion, "libs");
    const jarEntries = this.fileSystem.readdirSync(libsPath)
      .filter((jar) => /gauge|assertj-core/.test(jar))
      .map((jar) => ({
        kind: "lib",
        path: this.pathModule.join(libsPath, jar),
      }));
    this.writeConfigFile(
      classPathFile,
      classpathXml([...this.defaultClassPath(javaVersion), ...jarEntries]),
    );
  }

  createDotProjectFile(projectFile) {
    this.writeConfigFile(projectFile, projectXml(this.pathModule.basename(this.projectRoot)));
  }

  writeConfigFile(filename, content) {
    if (this.fileSystem.existsSync(filename)) {
      return;
    }
    this.fileSystem.writeFileSync(filename, content, "utf8");
  }
}

module.exports = {
  GaugeJavaProjectConfig,
};
