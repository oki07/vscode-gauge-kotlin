"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { GaugeProject } = require("./gaugeProject");
const { GradleProject } = require("./gradleProject");
const { MavenProject } = require("./mavenProject");

const GAUGE_MANIFEST_FILE = "manifest.json";
const MAVEN_BUILD_FILE = "pom.xml";
const GRADLE_BUILD_FILES = ["build.gradle", "build.gradle.kts"];

function manifestLanguage(manifest) {
  return manifest && (manifest.Language || manifest.language || manifest.langauge);
}

function isJvmLanguage(language) {
  return language === "java" || language === "kotlin";
}

function invalidProjectError(pathname) {
  return new Error(`${pathname} does not belong to a valid gauge project.`);
}

function createProjectFactory(options = {}) {
  const fileSystem = options.fileSystem || nodeFs;
  const pathModule = options.pathModule || nodePath;
  const projectOptions = {
    pathModule,
    execSync: options.execSync,
    vscode: options.vscode,
  };

  function exists(relativeRoot, filename) {
    return fileSystem.existsSync(pathModule.join(relativeRoot, filename));
  }

  const jvmProjectBuilders = [
    {
      predicate: (root) => exists(root, MAVEN_BUILD_FILE),
      build: (root, manifest) => new MavenProject(root, manifest, projectOptions),
    },
    {
      predicate: (root) => GRADLE_BUILD_FILES.some((filename) => exists(root, filename)),
      build: (root, manifest) => new GradleProject(root, manifest, projectOptions),
    },
  ];

  function isGaugeProject(root) {
    return Boolean(root) && exists(root, GAUGE_MANIFEST_FILE);
  }

  function readManifest(root) {
    const content = fileSystem.readFileSync(pathModule.join(root, GAUGE_MANIFEST_FILE));
    return JSON.parse(content.toString());
  }

  function get(root) {
    if (!root) {
      throw invalidProjectError(root);
    }

    const manifest = readManifest(root);
    if (isJvmLanguage(manifestLanguage(manifest))) {
      const builder = jvmProjectBuilders.find((entry) => entry.predicate(root));
      if (builder) {
        return builder.build(root, manifest);
      }
    }
    return new GaugeProject(root, manifest, projectOptions);
  }

  function getGaugeRootFromFilePath(filepath) {
    let current = filepath;
    while (!isGaugeProject(current)) {
      const parent = pathModule.parse(current).dir;
      if (!parent || parent === current) {
        throw invalidProjectError(filepath);
      }
      current = parent;
    }
    return current;
  }

  function getProjectByFilepath(filepath) {
    return get(getGaugeRootFromFilePath(filepath));
  }

  return {
    get,
    getGaugeRootFromFilePath,
    getProjectByFilepath,
    isGaugeProject,
  };
}

module.exports = {
  ProjectFactory: createProjectFactory(),
  createProjectFactory,
};
