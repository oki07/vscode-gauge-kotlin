"use strict";

const PROJECT_ENVIRONMENT_GLOB = "**/{manifest.json,pom.xml,build.gradle,build.gradle.kts,settings.gradle,settings.gradle.kts,gradle.properties,gradlew,gradlew.bat,gradlew.cmd,*.properties,*.toml}";
const PROJECT_EXECUTION_INPUT_GLOB = "**/src/**";
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

function normalizedPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
}

function isExecutionInput(file, root) {
  const normalizedFile = normalizedPath(file);
  const normalizedRoot = normalizedPath(root);
  return Boolean(
    normalizedFile
    && normalizedRoot
    && normalizedFile.startsWith(`${normalizedRoot}/src/`),
  );
}

function documentPath(document) {
  return uriPath(document && document.uri) || (document && document.fileName) || "";
}

// A build tool that failed to report a classpath yields an empty environment.
// Reusing or caching it would launch Gauge without gauge_custom_classpath, so
// every step and hook would be missing from the runner registry.
function isUsableEnvironment(environment) {
  return Boolean(
    environment
    && typeof environment === "object"
    && Object.keys(environment).length > 0,
  );
}

class ProjectEnvironmentService {
  constructor(options = {}) {
    this.cli = options.cli;
    this.projectFactory = options.projectFactory;
    this.vscode = options.vscode || {};
    this.environments = new Map();
    this.preparedExecutionRoots = new Set();
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
      try {
        const watcher = workspace.createFileSystemWatcher(PROJECT_EXECUTION_INPUT_GLOB);
        this.disposables.push(watcher);
        const invalidate = (uri) => this.invalidateExecutionForFile(uriPath(uri));
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
        // Saved-document invalidation still protects editor-driven source changes.
      }
    }
    if (typeof workspace.onDidSaveTextDocument === "function") {
      const disposable = workspace.onDidSaveTextDocument((document) => {
        this.invalidateExecutionForFile(documentPath(document));
      });
      if (disposable) {
        this.disposables.push(disposable);
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

  invalidateExecutionForFile(file) {
    const root = this.rootForFile(file);
    if (root && isExecutionInput(file, root)) {
      this.invalidateExecution(root);
    }
  }

  invalidateExecution(root) {
    if (root) {
      this.preparedExecutionRoots.delete(root);
    } else {
      this.preparedExecutionRoots.clear();
    }
  }

  invalidate(root) {
    if (root) {
      this.rootGenerations.set(root, (this.rootGenerations.get(root) || 0) + 1);
      this.environments.delete(root);
      this.pending.delete(root);
      this.preparedExecutionRoots.delete(root);
    } else {
      this.globalGeneration += 1;
      this.rootGenerations.clear();
      this.environments.clear();
      this.pending.clear();
      this.preparedExecutionRoots.clear();
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
      // Await the in-flight computation, then re-read the cache: a failed
      // computation resolves to an empty object without ever being stored,
      // and must not be mistaken for a completed preparation.
      await this.pending.get(root);
      cached = this.environments.get(root);
    }
    if (typeof project.executionEnvsAsync !== "function") {
      return this.environmentFor(project, cli);
    }
    const preparationCacheable = Boolean(
      typeof project.executionPreparationCacheable === "function"
      && project.executionPreparationCacheable(),
    );
    const skipBuild = preparationCacheable && this.preparedExecutionRoots.has(root);
    try {
      const environment = await project.executionEnvsAsync(cli, cached, { skipBuild });
      if (isUsableEnvironment(environment)) {
        if (
          this.globalGeneration === globalGeneration
          && (this.rootGenerations.get(root) || 0) === rootGeneration
        ) {
          this.environments.set(root, environment);
          if (preparationCacheable) {
            this.preparedExecutionRoots.add(root);
          }
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
    this.preparedExecutionRoots.delete(root);
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
    this.preparedExecutionRoots.clear();
    this.pending.clear();
    this.rootGenerations.clear();
  }
}

module.exports = {
  PROJECT_EXECUTION_INPUT_GLOB,
  PROJECT_ENVIRONMENT_GLOB,
  ProjectEnvironmentService,
};
