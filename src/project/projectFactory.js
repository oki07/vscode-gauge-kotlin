"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { GaugeProject } = require("./gaugeProject");
const { GradleProject } = require("./gradleProject");
const { MavenProject } = require("./mavenProject");
const {
  GAUGE_MANIFEST_FILE,
  isGaugeProjectRoot,
  manifestLanguage,
  readProjectManifest,
} = require("./manifest");

const MAVEN_BUILD_FILE = "pom.xml";
const GRADLE_BUILD_FILES = ["build.gradle", "build.gradle.kts"];
const NESTED_PROJECT_EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".gradle",
  ".hg",
  ".svn",
  ".vscode",
  "build",
  "dist",
  "node_modules",
  "out",
  "target",
]);

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
    execSync: options.execSync,
    fileSystem,
    gaugeConfig: options.gaugeConfig,
    gaugeConfigFactory: options.gaugeConfigFactory,
    pathModule,
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
    return isGaugeProjectRoot(fileSystem, pathModule, root);
  }

  function isDirectory(filename) {
    if (!fileSystem || typeof fileSystem.statSync !== "function") {
      return false;
    }
    try {
      const stat = fileSystem.statSync(filename);
      return Boolean(stat && typeof stat.isDirectory === "function" && stat.isDirectory());
    } catch (_error) {
      return false;
    }
  }

  function directoryEntries(dirname) {
    if (!fileSystem || typeof fileSystem.readdirSync !== "function") {
      return [];
    }
    try {
      return fileSystem.readdirSync(dirname)
        .map((entry) => (typeof entry === "string" ? entry : entry.name))
        .filter(Boolean)
        .sort();
    } catch (_error) {
      return [];
    }
  }

  function findGaugeProjectRoots(root) {
    if (!isDirectory(root)) {
      return isGaugeProject(root) ? [root] : [];
    }

    const roots = isGaugeProject(root) ? [root] : [];
    const pending = [root];
    const seen = new Set();
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current || seen.has(current)) {
        continue;
      }
      seen.add(current);
      for (const entry of directoryEntries(current)) {
        if (NESTED_PROJECT_EXCLUDED_DIRECTORIES.has(entry)) {
          continue;
        }
        const child = pathModule.join(current, entry);
        if (!isDirectory(child)) {
          continue;
        }
        if (isGaugeProject(child)) {
          roots.push(child);
        }
        pending.push(child);
      }
    }
    return roots.sort();
  }

  function readManifest(root) {
    return readProjectManifest(fileSystem, pathModule, root);
  }

  function get(root) {
    if (!root) {
      throw invalidProjectError(root);
    }

    const manifest = readManifest(root);
    const language = manifestLanguage(manifest);
    if (isJvmLanguage(language)) {
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
    findGaugeProjectRoots,
    getGaugeRootFromFilePath,
    getProjectByFilepath,
    isGaugeProject,
  };
}

module.exports = {
  ProjectFactory: createProjectFactory(),
  createProjectFactory,
};
