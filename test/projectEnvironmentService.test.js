"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createVscode() {
  const watchers = [];
  const configurationListeners = [];
  return {
    configurationListeners,
    vscode: {
      workspace: {
        createFileSystemWatcher(pattern) {
          const listeners = {};
          const watcher = {
            dispose() {},
            onDidChange(listener) {
              listeners.change = listener;
            },
            onDidCreate(listener) {
              listeners.create = listener;
            },
            onDidDelete(listener) {
              listeners.delete = listener;
            },
          };
          watchers.push({ listeners, pattern, watcher });
          return watcher;
        },
        onDidChangeConfiguration(listener) {
          configurationListeners.push(listener);
          return { dispose() {} };
        },
      },
    },
    watchers,
  };
}

test("ProjectEnvironmentService shares in-flight work and invalidates by root", async () => {
  const { ProjectEnvironmentService } = require("../src/projectEnvironmentService");
  const first = deferred();
  const roots = [];
  let computations = 0;
  const project = {
    root() {
      return "/workspace/gauge";
    },
    async envsAsync() {
      computations += 1;
      return computations === 1 ? first.promise : { gauge_custom_classpath: "after" };
    },
    envs() {
      throw new Error("synchronous environment lookup must not run");
    },
  };
  const { configurationListeners, vscode, watchers } = createVscode();
  const service = new ProjectEnvironmentService({
    projectFactory: {
      getGaugeRootFromFilePath(file) {
        roots.push(file);
        return "/workspace/gauge";
      },
    },
    vscode,
  });
  service.start();

  const firstRequest = service.environmentFor(project);
  const secondRequest = service.environmentFor(project);
  await Promise.resolve();
  assert.equal(computations, 1);
  first.resolve({ gauge_custom_classpath: "before" });
  assert.deepEqual(await firstRequest, { gauge_custom_classpath: "before" });
  assert.deepEqual(await secondRequest, { gauge_custom_classpath: "before" });
  assert.equal(computations, 1);

  watchers[0].listeners.change({ fsPath: "/workspace/gauge/build.gradle.kts" });
  assert.deepEqual(await service.environmentFor(project), { gauge_custom_classpath: "after" });
  assert.equal(computations, 2);
  assert.deepEqual(roots, ["/workspace/gauge/build.gradle.kts"]);

  configurationListeners[0]({
    affectsConfiguration(section) {
      return section === "gauge.home";
    },
  });
  await service.environmentFor(project);
  assert.equal(computations, 3);
});

test("ProjectEnvironmentService retries failed environment computations", async () => {
  const { ProjectEnvironmentService } = require("../src/projectEnvironmentService");
  let computations = 0;
  const service = new ProjectEnvironmentService();
  const project = {
    root() {
      return "/workspace/gauge";
    },
    async envsAsync() {
      computations += 1;
      if (computations === 1) {
        throw new Error("temporary failure");
      }
      return { gauge_custom_classpath: "recovered" };
    },
  };

  assert.deepEqual(await service.environmentFor(project), {});
  assert.deepEqual(await service.environmentFor(project), { gauge_custom_classpath: "recovered" });
  assert.equal(computations, 2);
});

test("ProjectEnvironmentService does not restore stale work after invalidation", async () => {
  const { ProjectEnvironmentService } = require("../src/projectEnvironmentService");
  const stale = deferred();
  let computations = 0;
  const service = new ProjectEnvironmentService();
  const project = {
    root() {
      return "/workspace/gauge";
    },
    async envsAsync() {
      computations += 1;
      return computations === 1
        ? stale.promise
        : { gauge_custom_classpath: "fresh" };
    },
  };

  const staleRequest = service.environmentFor(project);
  await Promise.resolve();
  service.invalidate("/workspace/gauge");
  stale.resolve({ gauge_custom_classpath: "stale" });
  assert.deepEqual(await staleRequest, { gauge_custom_classpath: "stale" });

  assert.deepEqual(
    await service.environmentFor(project),
    { gauge_custom_classpath: "fresh" },
  );
  assert.equal(computations, 2);
});

test("ProjectEnvironmentService shares one environment across consumers", async () => {
  const { DependencyStepIndex } = require("../src/dependencyStepIndex");
  const { GaugeFormatProvider } = require("../src/formatProvider");
  const { ProjectEnvironmentService } = require("../src/projectEnvironmentService");
  const { GaugeValidateDiagnosticsProvider } = require("../src/validateDiagnostics");
  let computations = 0;
  const project = {
    root() {
      return "/workspace/gauge";
    },
    async envsAsync() {
      computations += 1;
      return { gauge_custom_classpath: "/workspace/classes" };
    },
  };
  const service = new ProjectEnvironmentService();
  const format = new GaugeFormatProvider({ projectEnvironmentService: service, vscode: {} });
  const validate = new GaugeValidateDiagnosticsProvider({
    projectEnvironmentService: service,
    vscode: {},
  });
  const dependency = new DependencyStepIndex({
    pathModule: require("node:path").posix,
    projectEnvironmentService: service,
    projectFactory: { get() { return project; } },
    vscode: {},
  });

  await format.cachedProjectEnvironment(project);
  await validate.projectEnvironmentAsync(project);
  await dependency.projectClasspath("/workspace/gauge");

  assert.equal(computations, 1);
});
