"use strict";

const PROJECT_ENVIRONMENT_GLOB = "**/{manifest.json,pom.xml,build.gradle,build.gradle.kts,settings.gradle,settings.gradle.kts,gradle.properties,gradlew,gradlew.bat,gradlew.cmd,*.properties}";
const GAUGE_ENVIRONMENT_CONFIGURATIONS = [
  "gauge.executablePath",
  "gauge.home",
];

function uriPath(uri) {
  return (uri && (uri.fsPath || uri.path)) || "";
}

function projectRoot(project) {
  if (!project) {
    return "";
  }
  return typeof project.root === "function"
    ? project.root()
    : project.root || project.projectRoot || "";
}

class ProjectEnvironmentService {
  constructor(options = {}) {
    this.cli = options.cli;
    this.projectFactory = options.projectFactory;
    this.vscode = options.vscode || {};
    this.environments = new Map();
    this.pending = new Map();
    this.rootGenerations = new Map();
    this.globalGeneration = 0;
    this.invalidationListeners = new Set();
    this.disposables = [];
    this.started = false;
    this.disposed = false;
  }

  start() {
    if (this.started || this.disposed) {
      return;
    }
    this.started = true;
    const workspace = this.vscode.workspace || {};
    if (typeof workspace.createFileSystemWatcher === "function") {
      try {
        const watcher = workspace.createFileSystemWatcher(PROJECT_ENVIRONMENT_GLOB);
        this.disposables.push(watcher);
        const invalidate = (uri) => this.invalidateForFile(uriPath(uri));
        if (typeof watcher.onDidCreate === "function") {
          watcher.onDidCreate(invalidate);
        }
        if (typeof watcher.onDidChange === "function") {
          watcher.onDidChange(invalidate);
        }
        if (typeof watcher.onDidDelete === "function") {
          watcher.onDidDelete(invalidate);
        }
      } catch (_error) {
        // Environment caching still works when file watchers are unavailable.
      }
    }
    if (typeof workspace.onDidChangeConfiguration === "function") {
      const disposable = workspace.onDidChangeConfiguration((event) => {
        if (
          !event
          || typeof event.affectsConfiguration !== "function"
          || GAUGE_ENVIRONMENT_CONFIGURATIONS.some((section) => event.affectsConfiguration(section))
        ) {
          this.invalidate();
        }
      });
      if (disposable) {
        this.disposables.push(disposable);
      }
    }
  }

  onDidInvalidate(listener) {
    this.invalidationListeners.add(listener);
    return { dispose: () => this.invalidationListeners.delete(listener) };
  }

  projectForRoot(root) {
    if (!root || !this.projectFactory) {
      return undefined;
    }
    if (typeof this.projectFactory.get === "function") {
      return this.projectFactory.get(root);
    }
    if (typeof this.projectFactory.getProjectByFilepath === "function") {
      return this.projectFactory.getProjectByFilepath(root);
    }
    return undefined;
  }

  rootForFile(file) {
    if (
      !file
      || !this.projectFactory
      || typeof this.projectFactory.getGaugeRootFromFilePath !== "function"
    ) {
      return undefined;
    }
    try {
      return this.projectFactory.getGaugeRootFromFilePath(file) || undefined;
    } catch (_error) {
      return undefined;
    }
  }

  invalidateForFile(file) {
    const root = this.rootForFile(file);
    if (root) {
      this.invalidate(root);
    }
  }

  invalidate(root) {
    if (root) {
      this.rootGenerations.set(root, (this.rootGenerations.get(root) || 0) + 1);
      this.environments.delete(root);
      this.pending.delete(root);
    } else {
      this.globalGeneration += 1;
      this.rootGenerations.clear();
      this.environments.clear();
      this.pending.clear();
    }
    for (const listener of [...this.invalidationListeners]) {
      try {
        listener(root);
      } catch (_error) {
        // One invalidation listener must not block the others.
      }
    }
  }

  cachedEnvironment(root) {
    return this.environments.get(root);
  }

  async computeEnvironment(project, cli) {
    if (project && typeof project.envsAsync === "function") {
      return project.envsAsync(cli);
    }
    if (project && typeof project.envs === "function") {
      return project.envs(cli);
    }
    return {};
  }

  environmentFor(projectOrRoot, cli = this.cli) {
    this.start();
    const project = typeof projectOrRoot === "string"
      ? this.projectForRoot(projectOrRoot)
      : projectOrRoot;
    const root = projectRoot(project) || (typeof projectOrRoot === "string" ? projectOrRoot : "");
    if (!root) {
      return Promise.resolve({});
    }
    if (this.environments.has(root)) {
      return Promise.resolve(this.environments.get(root));
    }
    if (this.pending.has(root)) {
      return this.pending.get(root);
    }
    const globalGeneration = this.globalGeneration;
    const rootGeneration = this.rootGenerations.get(root) || 0;
    const computation = Promise.resolve()
      .then(() => this.computeEnvironment(project, cli))
      .then((environment) => {
        if (environment && typeof environment === "object") {
          if (
            this.globalGeneration === globalGeneration
            && (this.rootGenerations.get(root) || 0) === rootGeneration
          ) {
            this.environments.set(root, environment);
          }
          return environment;
        }
        return {};
      })
      .catch(() => ({}))
      .finally(() => {
        if (this.pending.get(root) === computation) {
          this.pending.delete(root);
        }
      });
    this.pending.set(root, computation);
    return computation;
  }

  async executionEnvironmentFor(project, cli = this.cli) {
    this.start();
    const root = projectRoot(project);
    if (!project || !root) {
      return {};
    }
    const globalGeneration = this.globalGeneration;
    const rootGeneration = this.rootGenerations.get(root) || 0;
    let cached = this.environments.get(root);
    if (!cached && this.pending.has(root)) {
      cached = await this.pending.get(root);
    }
    if (typeof project.executionEnvsAsync !== "function") {
      return this.environmentFor(project, cli);
    }
    try {
      const environment = await project.executionEnvsAsync(cli, cached);
      if (environment && typeof environment === "object") {
        if (
          this.globalGeneration === globalGeneration
          && (this.rootGenerations.get(root) || 0) === rootGeneration
        ) {
          this.environments.set(root, environment);
        }
        return environment;
      }
    } catch (_error) {
      // A failed build or classpath query is intentionally retried next time.
    }
    if (
      this.globalGeneration === globalGeneration
      && (this.rootGenerations.get(root) || 0) === rootGeneration
    ) {
      this.environments.delete(root);
    }
    return undefined;
  }

  dispose() {
    this.disposed = true;
    this.invalidationListeners.clear();
    for (const disposable of this.disposables) {
      if (disposable && typeof disposable.dispose === "function") {
        disposable.dispose();
      }
    }
    this.disposables = [];
    this.environments.clear();
    this.pending.clear();
    this.rootGenerations.clear();
  }
}

module.exports = {
  PROJECT_ENVIRONMENT_GLOB,
  ProjectEnvironmentService,
};
