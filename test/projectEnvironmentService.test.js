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

test("ProjectEnvironmentService preserves source invalidation during in-flight Maven preparation", async () => {
  const { ProjectEnvironmentService } = require("../src/projectEnvironmentService");
  const buildEntered = deferred();
  const releaseBuild = deferred();
  const calls = [];
  const environment = {
    gauge_custom_classpath: "/workspace/gauge/target/test-classes",
  };
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
      if (calls.length === 1) {
        buildEntered.resolve();
        await releaseBuild.promise;
      }
      return environment;
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

  const firstEnvironment = service.executionEnvironmentFor(project);
  await buildEntered.promise;
  saveListeners[0]({
    uri: { fsPath: "/workspace/gauge/src/test/kotlin/Steps.kt" },
  });
  releaseBuild.resolve();
  assert.equal(await firstEnvironment, environment);

  const preparedAfterInvalidatedBuild = service.preparedExecutionRoots.has(
    "/workspace/gauge",
  );
  assert.equal(await service.executionEnvironmentFor(project), environment);

  assert.equal(preparedAfterInvalidatedBuild, false);
  assert.deepEqual(calls, [
    { cached: undefined, skipBuild: false },
    { cached: environment, skipBuild: false },
  ]);
});

test("ProjectEnvironmentService keeps another root prepared when one in-flight Maven build is invalidated", async () => {
  const { ProjectEnvironmentService } = require("../src/projectEnvironmentService");
  const roots = ["/workspace/a", "/workspace/b"];
  const entered = new Map(roots.map((root) => [root, deferred()]));
  const releases = new Map(roots.map((root) => [root, deferred()]));
  const calls = new Map(roots.map((root) => [root, []]));
  const projects = roots.map((root) => ({
    root() {
      return root;
    },
    executionPreparationCacheable() {
      return true;
    },
    async executionEnvsAsync(_cli, _cached, options) {
      const rootCalls = calls.get(root);
      rootCalls.push(Boolean(options && options.skipBuild));
      if (rootCalls.length === 1) {
        entered.get(root).resolve();
        await releases.get(root).promise;
      }
      return { gauge_custom_classpath: `${root}/target/test-classes` };
    },
  }));
  const { saveListeners, vscode } = createVscode();
  const service = new ProjectEnvironmentService({
    projectFactory: {
      getGaugeRootFromFilePath(file) {
        return roots.find((root) => file === root || file.startsWith(`${root}/`));
      },
    },
    vscode,
  });

  const firstPreparations = projects.map((project) => service.executionEnvironmentFor(project));
  await Promise.all([...entered.values()].map((gate) => gate.promise));
  saveListeners[0]({
    uri: { fsPath: "/workspace/a/src/test/kotlin/Steps.kt" },
  });
  for (const gate of releases.values()) {
    gate.resolve();
  }
  await Promise.all(firstPreparations);

  assert.equal(service.preparedExecutionRoots.has("/workspace/a"), false);
  assert.equal(service.preparedExecutionRoots.has("/workspace/b"), true);
  await Promise.all(projects.map((project) => service.executionEnvironmentFor(project)));
  assert.deepEqual(calls.get("/workspace/a"), [false, false]);
  assert.deepEqual(calls.get("/workspace/b"), [false, true]);
});

test("ProjectEnvironmentService keeps a newer Maven preparation after a stale build fails", async () => {
  const { ProjectEnvironmentService } = require("../src/projectEnvironmentService");
  const firstBuildEntered = deferred();
  const releaseFirstBuild = deferred();
  const skipBuilds = [];
  const environment = {
    gauge_custom_classpath: "/workspace/gauge/target/test-classes",
  };
  const project = {
    root() {
      return "/workspace/gauge";
    },
    executionPreparationCacheable() {
      return true;
    },
    async executionEnvsAsync(_cli, _cached, options) {
      skipBuilds.push(Boolean(options && options.skipBuild));
      if (skipBuilds.length === 1) {
        firstBuildEntered.resolve();
        return releaseFirstBuild.promise;
      }
      return environment;
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

  const stalePreparation = service.executionEnvironmentFor(project);
  await firstBuildEntered.promise;
  saveListeners[0]({
    uri: { fsPath: "/workspace/gauge/src/test/kotlin/Steps.kt" },
  });
  assert.equal(await service.executionEnvironmentFor(project), environment);
  releaseFirstBuild.resolve({});
  assert.equal(await stalePreparation, undefined);

  assert.equal(service.preparedExecutionRoots.has("/workspace/gauge"), true);
  assert.equal(service.cachedEnvironment("/workspace/gauge"), environment);
  assert.equal(await service.executionEnvironmentFor(project), environment);
  assert.deepEqual(skipBuilds, [false, false, true]);
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

test("ProjectEnvironmentService watches every Gradle build script for environment changes", async () => {
  const {
    PROJECT_ENVIRONMENT_GLOB,
    ProjectEnvironmentService,
  } = require("../src/projectEnvironmentService");
  assert.equal(PROJECT_ENVIRONMENT_GLOB.includes("*.gradle.kts"), true);
  assert.equal(PROJECT_ENVIRONMENT_GLOB.includes("*.gradle,"), true);

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
  // A convention plugin adds the dependency, so no file named build.gradle.kts
  // changes at all.
  environmentWatcher.listeners.change({
    fsPath: "/ws/buildSrc/src/main/kotlin/my-conventions.gradle.kts",
  });
  const second = await service.environmentFor("/ws");

  assert.deepEqual(first, { gauge_custom_classpath: "cp-1" });
  assert.deepEqual(second, { gauge_custom_classpath: "cp-2" });
});

test("ProjectEnvironmentService returns no cached environment after disposal", async () => {
  const { ProjectEnvironmentService } = require("../src/projectEnvironmentService");
  const computationEntered = deferred();
  const releaseComputation = deferred();
  let computations = 0;
  const project = {
    root: () => "/workspace/gauge",
    async envsAsync() {
      computations += 1;
      computationEntered.resolve();
      return releaseComputation.promise;
    },
  };
  const service = new ProjectEnvironmentService();

  const pendingEnvironment = service.environmentFor(project);
  await computationEntered.promise;
  assert.equal(service.pending.size, 1);

  service.dispose();
  const laterEnvironment = service.environmentFor(project);
  releaseComputation.resolve({ gauge_custom_classpath: "/workspace/classes" });

  assert.deepEqual(
    await Promise.all([pendingEnvironment, laterEnvironment]),
    [{}, {}],
  );
  assert.deepEqual({
    computations,
    environments: service.environments.size,
    pending: service.pending.size,
    preparedRoots: service.preparedExecutionRoots.size,
  }, {
    computations: 1,
    environments: 0,
    pending: 0,
    preparedRoots: 0,
  });
});

test("ProjectEnvironmentService returns no execution environment after disposal", async () => {
  const { ProjectEnvironmentService } = require("../src/projectEnvironmentService");
  const preparationEntered = deferred();
  const releasePreparation = deferred();
  let preparations = 0;
  const project = {
    root: () => "/workspace/gauge",
    executionPreparationCacheable: () => true,
    async executionEnvsAsync() {
      preparations += 1;
      preparationEntered.resolve();
      return releasePreparation.promise;
    },
  };
  const service = new ProjectEnvironmentService();

  const pendingEnvironment = service.executionEnvironmentFor(project);
  await preparationEntered.promise;
  service.dispose();
  const laterEnvironment = service.executionEnvironmentFor(project);
  releasePreparation.resolve({ gauge_custom_classpath: "/workspace/classes" });

  assert.deepEqual(
    await Promise.all([pendingEnvironment, laterEnvironment]),
    [undefined, undefined],
  );
  assert.deepEqual({
    environments: service.environments.size,
    pending: service.pending.size,
    preparations,
    preparedRoots: service.preparedExecutionRoots.size,
  }, {
    environments: 0,
    pending: 0,
    preparations: 1,
    preparedRoots: 0,
  });
});

test("ProjectEnvironmentService returns no fallback execution environment after disposal", async () => {
  const { ProjectEnvironmentService } = require("../src/projectEnvironmentService");
  const computationEntered = deferred();
  const releaseComputation = deferred();
  let computations = 0;
  const project = {
    root: () => "/workspace/gauge",
    async envsAsync() {
      computations += 1;
      computationEntered.resolve();
      return releaseComputation.promise;
    },
  };
  const service = new ProjectEnvironmentService();

  const pendingEnvironment = service.executionEnvironmentFor(project);
  await computationEntered.promise;
  service.dispose();
  releaseComputation.resolve({ gauge_custom_classpath: "/workspace/classes" });

  assert.equal(await pendingEnvironment, undefined);
  assert.equal(await service.executionEnvironmentFor(project), undefined);
  assert.deepEqual({
    computations,
    environments: service.environments.size,
    pending: service.pending.size,
  }, {
    computations: 1,
    environments: 0,
    pending: 0,
  });
});

test("ProjectEnvironmentService does not start deferred work after disposal", async () => {
  const { ProjectEnvironmentService } = require("../src/projectEnvironmentService");
  let computations = 0;
  const project = {
    root: () => "/workspace/gauge",
    async envsAsync() {
      computations += 1;
      return { gauge_custom_classpath: "/workspace/classes" };
    },
  };
  const service = new ProjectEnvironmentService();

  const pendingEnvironment = service.environmentFor(project);
  service.dispose();

  assert.deepEqual(await pendingEnvironment, {});
  assert.equal(computations, 0);
  assert.equal(service.environments.size, 0);
  assert.equal(service.pending.size, 0);
});
