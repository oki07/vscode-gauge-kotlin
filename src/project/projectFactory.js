"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { concurrencyLimit, mapWithConcurrency } = require("../asyncWork");
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
const DEFAULT_PROJECT_DISCOVERY_CONCURRENCY = 16;
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

const GAUGE_MANIFEST_GLOB = "**/manifest.json";

function createProjectFactory(options = {}) {
  const fileSystem = options.fileSystem || nodeFs;
  const pathModule = options.pathModule || nodePath;
  const projectOptions = {
    exec: options.exec,
    execSync: options.execSync,
    fileSystem,
    gaugeConfig: options.gaugeConfig,
    gaugeConfigFactory: options.gaugeConfigFactory,
    pathModule,
    vscode: options.vscode,
  };

  const projectCache = new Map();
  const gaugeProjectCache = new Map();
  const rootLookupCache = new Map();
  const rootsDiscoveryCache = new Map();
  const rootsDiscoveryPending = new Map();
  const projectDiscoveryConcurrency = concurrencyLimit(
    options.projectDiscoveryConcurrency,
    DEFAULT_PROJECT_DISCOVERY_CONCURRENCY,
  );
  let discoveryGeneration = 0;
  const NO_ROOT = Symbol("noGaugeRoot");

  function invalidate() {
    discoveryGeneration += 1;
    projectCache.clear();
    gaugeProjectCache.clear();
    rootLookupCache.clear();
    rootsDiscoveryCache.clear();
    rootsDiscoveryPending.clear();
  }

  function registerManifestWatcher() {
    const workspace = options.vscode && options.vscode.workspace;
    if (!workspace || typeof workspace.createFileSystemWatcher !== "function") {
      return;
    }
    try {
      const watcher = workspace.createFileSystemWatcher(GAUGE_MANIFEST_GLOB);
      const onEvent = () => invalidate();
      if (typeof watcher.onDidCreate === "function") {
        watcher.onDidCreate(onEvent);
      }
      if (typeof watcher.onDidChange === "function") {
        watcher.onDidChange(onEvent);
      }
      if (typeof watcher.onDidDelete === "function") {
        watcher.onDidDelete(onEvent);
      }
    } catch (_error) {
      // Root resolution still works without watcher-based invalidation.
    }
  }
  registerManifestWatcher();

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
    if (gaugeProjectCache.has(root)) {
      return gaugeProjectCache.get(root);
    }
    const result = isGaugeProjectRoot(fileSystem, pathModule, root);
    gaugeProjectCache.set(root, result);
    return result;
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
    if (rootsDiscoveryCache.has(root)) {
      return rootsDiscoveryCache.get(root);
    }
    const roots = discoverGaugeProjectRoots(root);
    rootsDiscoveryCache.set(root, roots);
    return roots;
  }

  async function isDirectoryAsync(filename) {
    const promises = fileSystem && fileSystem.promises;
    if (promises && typeof promises.stat === "function") {
      try {
        const stat = await promises.stat(filename);
        return Boolean(stat && typeof stat.isDirectory === "function" && stat.isDirectory());
      } catch (_error) {
        return false;
      }
    }
    return isDirectory(filename);
  }

  async function directoryEntriesAsync(dirname) {
    const promises = fileSystem && fileSystem.promises;
    if (promises && typeof promises.readdir === "function") {
      try {
        return (await promises.readdir(dirname))
          .map((entry) => (typeof entry === "string" ? entry : entry.name))
          .filter(Boolean)
          .sort();
      } catch (_error) {
        return [];
      }
    }
    return directoryEntries(dirname);
  }

  async function isGaugeProjectAsync(root) {
    if (gaugeProjectCache.has(root)) {
      return gaugeProjectCache.get(root);
    }
    const promises = fileSystem && fileSystem.promises;
    const manifest = pathModule.join(root, GAUGE_MANIFEST_FILE);
    if (promises && typeof promises.access === "function") {
      try {
        await promises.access(manifest);
        return true;
      } catch (_error) {
        return false;
      }
    }
    if (promises && typeof promises.stat === "function") {
      try {
        const stat = await promises.stat(manifest);
        return Boolean(stat && (typeof stat.isFile !== "function" || stat.isFile()));
      } catch (_error) {
        return false;
      }
    }
    return isGaugeProject(root);
  }

  async function discoverGaugeProjectRootsAsync(root) {
    if (!await isDirectoryAsync(root)) {
      return await isGaugeProjectAsync(root) ? [root] : [];
    }

    const roots = await isGaugeProjectAsync(root) ? [root] : [];
    const pending = [root];
    const seen = new Set();
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current || seen.has(current)) {
        continue;
      }
      seen.add(current);
      const entries = await directoryEntriesAsync(current);
      const children = await mapWithConcurrency(
        entries,
        projectDiscoveryConcurrency,
        async (entry) => {
          if (NESTED_PROJECT_EXCLUDED_DIRECTORIES.has(entry)) {
            return undefined;
          }
          const child = pathModule.join(current, entry);
          if (!await isDirectoryAsync(child)) {
            return undefined;
          }
          return {
            child,
            gaugeProject: await isGaugeProjectAsync(child),
          };
        },
      );
      for (const child of children) {
        if (!child) {
          continue;
        }
        if (child.gaugeProject) {
          roots.push(child.child);
        }
        pending.push(child.child);
      }
    }
    return roots.sort();
  }

  function findGaugeProjectRootsAsync(root) {
    if (rootsDiscoveryCache.has(root)) {
      return Promise.resolve(rootsDiscoveryCache.get(root));
    }
    if (rootsDiscoveryPending.has(root)) {
      return rootsDiscoveryPending.get(root);
    }
    const generation = discoveryGeneration;
    const discovery = discoverGaugeProjectRootsAsync(root)
      .then((roots) => {
        if (discoveryGeneration === generation) {
          rootsDiscoveryCache.set(root, roots);
        }
        return roots;
      })
      .finally(() => {
        if (rootsDiscoveryPending.get(root) === discovery) {
          rootsDiscoveryPending.delete(root);
        }
      });
    rootsDiscoveryPending.set(root, discovery);
    return discovery;
  }

  function discoverGaugeProjectRoots(root) {
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
    if (projectCache.has(root)) {
      return projectCache.get(root);
    }

    const manifest = readManifest(root);
    const language = manifestLanguage(manifest);
    let project;
    if (isJvmLanguage(language)) {
      const builder = jvmProjectBuilders.find((entry) => entry.predicate(root));
      if (builder) {
        project = builder.build(root, manifest);
      }
    }
    if (!project) {
      project = new GaugeProject(root, manifest, projectOptions);
    }
    projectCache.set(root, project);
    return project;
  }

  function getGaugeRootFromFilePath(filepath) {
    const cached = rootLookupCache.get(filepath);
    if (cached !== undefined) {
      if (cached === NO_ROOT) {
        throw invalidProjectError(filepath);
      }
      return cached;
    }
    const visited = [filepath];
    let current = filepath;
    while (!isGaugeProject(current)) {
      const parent = pathModule.parse(current).dir;
      if (!parent || parent === current) {
        for (const entry of visited) {
          rootLookupCache.set(entry, NO_ROOT);
        }
        throw invalidProjectError(filepath);
      }
      current = parent;
      visited.push(current);
    }
    for (const entry of visited) {
      rootLookupCache.set(entry, current);
    }
    return current;
  }

  function getProjectByFilepath(filepath) {
    return get(getGaugeRootFromFilePath(filepath));
  }

  return {
    get,
    findGaugeProjectRoots,
    findGaugeProjectRootsAsync,
    getGaugeRootFromFilePath,
    getProjectByFilepath,
    invalidate,
    isGaugeProject,
  };
}

module.exports = {
  DEFAULT_PROJECT_DISCOVERY_CONCURRENCY,
  ProjectFactory: createProjectFactory(),
  createProjectFactory,
};
