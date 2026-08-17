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
  const saveListeners = [];
  return {
    configurationListeners,
    saveListeners,
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
        onDidSaveTextDocument(listener) {
          saveListeners.push(listener);
          return { dispose() {} };
        },
      },
    },
    watchers,
  };
}

test("ProjectEnvironmentService reuses Maven preparation until source inputs change", async () => {
  const { ProjectEnvironmentService } = require("../src/projectEnvironmentService");
  const calls = [];
  const project = {
    root() {
      return "/workspace/gauge";
    },
    executionPreparationCacheable() {
      return true;
    },
    async executionEnvsAsync(_cli, cached, options) {
      calls.push({
        cached,
        skipBuild: Boolean(options && options.skipBuild),
      });
      return cached || { gauge_custom_classpath: "/workspace/gauge/target/test-classes" };
    },
  };
  const { saveListeners, vscode, watchers } = createVscode();
  const service = new ProjectEnvironmentService({
    projectFactory: {
      getGaugeRootFromFilePath() {
        return "/workspace/gauge";
      },
    },
    vscode,
  });

  await service.executionEnvironmentFor(project);
  await service.executionEnvironmentFor(project);

  assert.equal(saveListeners.length, 1);
  saveListeners[0]({
    uri: { fsPath: "/workspace/gauge/src/test/kotlin/Steps.kt" },
  });
  await service.executionEnvironmentFor(project);
  await service.executionEnvironmentFor(project);

  const sourceWatcher = watchers.find(({ pattern }) => pattern === "**/src/**");
  assert.notEqual(sourceWatcher, undefined);
  sourceWatcher.listeners.change({
    fsPath: "/workspace/gauge/src/test/resources/example.json",
  });
  await service.executionEnvironmentFor(project);

  assert.deepEqual(calls, [
    { cached: undefined, skipBuild: false },
    {
      cached: { gauge_custom_classpath: "/workspace/gauge/target/test-classes" },
      skipBuild: true,
    },
    {
      cached: { gauge_custom_classpath: "/workspace/gauge/target/test-classes" },
      skipBuild: false,
    },
    {
      cached: { gauge_custom_classpath: "/workspace/gauge/target/test-classes" },
      skipBuild: true,
    },
    {
      cached: { gauge_custom_classpath: "/workspace/gauge/target/test-classes" },
      skipBuild: false,
    },
  ]);
});

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

test("ProjectEnvironmentService watches Gradle version catalogs for environment changes", async () => {
  const {
    PROJECT_ENVIRONMENT_GLOB,
    ProjectEnvironmentService,
  } = require("../src/projectEnvironmentService");
  assert.equal(PROJECT_ENVIRONMENT_GLOB.includes("*.toml"), true);

  const { vscode, watchers } = createVscode();
  let computations = 0;
  const project = {
    root: () => "/ws",
    envsAsync: async () => ({ gauge_custom_classpath: `cp-${++computations}` }),
  };
  const projectFactory = {
    get: () => project,
    getGaugeRootFromFilePath: (file) => (
      file === "/ws" || file.startsWith("/ws/") ? "/ws" : undefined
    ),
  };
  const service = new ProjectEnvironmentService({ projectFactory, vscode });

  const first = await service.environmentFor("/ws");
  const environmentWatcher = watchers.find((entry) => entry.pattern === PROJECT_ENVIRONMENT_GLOB);
  environmentWatcher.listeners.change({ fsPath: "/ws/gradle/libs.versions.toml" });
  const second = await service.environmentFor("/ws");

  assert.deepEqual(first, { gauge_custom_classpath: "cp-1" });
  assert.deepEqual(second, { gauge_custom_classpath: "cp-2" });
});

test("ProjectEnvironmentService never adopts a classpath-less environment as a preparation", async () => {
  const { ProjectEnvironmentService } = require("../src/projectEnvironmentService");
  let attempts = 0;
  const preparations = [];
  const project = {
    root: () => "/ws",
    executionPreparationCacheable: () => true,
    async envsAsync() {
      attempts += 1;
      return attempts === 1 ? undefined : { gauge_custom_classpath: "/ws/build/classes" };
    },
    async executionEnvsAsync(_cli, cached) {
      preparations.push(cached);
      if (cached) {
        return cached;
      }
      attempts += 1;
      return { gauge_custom_classpath: "/ws/build/classes" };
    },
  };
  const service = new ProjectEnvironmentService({
    projectFactory: { get: () => project },
    vscode: {},
  });

  const inFlight = service.environmentFor(project);
  const firstRun = await service.executionEnvironmentFor(project);
  await inFlight;
  const secondRun = await service.executionEnvironmentFor(project);

  assert.deepEqual(preparations[0], undefined);
  assert.deepEqual(firstRun, { gauge_custom_classpath: "/ws/build/classes" });
  assert.deepEqual(secondRun, { gauge_custom_classpath: "/ws/build/classes" });
  assert.deepEqual(service.cachedEnvironment("/ws"), {
    gauge_custom_classpath: "/ws/build/classes",
  });
});

test("ProjectEnvironmentService does not cache an environment without a classpath", async () => {
  const { ProjectEnvironmentService } = require("../src/projectEnvironmentService");
  const project = {
    root: () => "/ws",
    async executionEnvsAsync() {
      return {};
    },
  };
  const service = new ProjectEnvironmentService({
    projectFactory: { get: () => project },
    vscode: {},
  });

  assert.equal(await service.executionEnvironmentFor(project), undefined);
  assert.equal(service.cachedEnvironment("/ws"), undefined);
});

test("ProjectEnvironmentService rebuilds when a source outside the root src directory changes", async () => {
  const { ProjectEnvironmentService } = require("../src/projectEnvironmentService");
  const builds = [];
  const project = {
    root: () => "/workspace/gauge",
    executionPreparationCacheable: () => true,
    async executionEnvsAsync(_cli, cached, options) {
      if (!options || !options.skipBuild) {
        builds.push("test-compile");
      }
      return cached || { gauge_custom_classpath: "/workspace/gauge/target/test-classes" };
    },
  };
  const { saveListeners, vscode } = createVscode();
  const service = new ProjectEnvironmentService({
    projectFactory: {
      getGaugeRootFromFilePath() {
        return "/workspace/gauge";
      },
    },
    vscode,
  });

  await service.executionEnvironmentFor(project);
  assert.deepEqual(builds, ["test-compile"]);

  // A Maven or Gradle module keeps its sources under <root>/<module>/src.
  saveListeners[0]({
    uri: { fsPath: "/workspace/gauge/moduleA/src/test/kotlin/Steps.kt" },
  });
  await service.executionEnvironmentFor(project);

  assert.deepEqual(builds, ["test-compile", "test-compile"]);
});

test("ProjectEnvironmentService ignores build output when deciding to rebuild", async () => {
  const { ProjectEnvironmentService } = require("../src/projectEnvironmentService");
  const builds = [];
  const project = {
    root: () => "/workspace/gauge",
    executionPreparationCacheable: () => true,
    async executionEnvsAsync(_cli, cached, options) {
      if (!options || !options.skipBuild) {
        builds.push("test-compile");
      }
      return cached || { gauge_custom_classpath: "/workspace/gauge/target/test-classes" };
    },
  };
  const { saveListeners, vscode } = createVscode();
  const service = new ProjectEnvironmentService({
    projectFactory: {
      getGaugeRootFromFilePath() {
        return "/workspace/gauge";
      },
    },
    vscode,
  });

  await service.executionEnvironmentFor(project);
  for (const file of [
    "/workspace/gauge/target/test-classes/Steps.class",
    "/workspace/gauge/build/generated/kotlin/Generated.kt",
    "/workspace/gauge/logs/gauge.log",
    "/workspace/gauge/reports/html-report/index.html",
    "/workspace/gauge/.gauge/last_run_result",
  ]) {
    saveListeners[0]({ uri: { fsPath: file } });
  }
  await service.executionEnvironmentFor(project);

  assert.deepEqual(builds, ["test-compile"]);
});
