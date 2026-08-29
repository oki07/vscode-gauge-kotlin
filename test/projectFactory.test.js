const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

function createFakeFileSystem(entries) {
  const files = new Map(Object.entries(entries));
  function childPrefix(dirname) {
    return dirname.endsWith("/") ? dirname : `${dirname}/`;
  }
  function isDirectory(filename) {
    const prefix = childPrefix(filename);
    return [...files.keys()].some((entry) => entry.startsWith(prefix));
  }
  return {
    existsSync(filename) {
      return files.has(filename);
    },
    readdirSync(dirname) {
      const prefix = childPrefix(dirname);
      const names = new Set();
      for (const filename of files.keys()) {
        if (!filename.startsWith(prefix)) {
          continue;
        }
        const rest = filename.slice(prefix.length);
        const [name] = rest.split("/");
        if (name) {
          names.add(name);
        }
      }
      return [...names].sort();
    },
    readFileSync(filename) {
      if (!files.has(filename)) {
        throw new Error(`Missing ${filename}`);
      }
      return Buffer.from(files.get(filename));
    },
    statSync(filename) {
      if (files.has(filename)) {
        return { isDirectory: () => false };
      }
      if (isDirectory(filename)) {
        return { isDirectory: () => true };
      }
      throw new Error(`Missing ${filename}`);
    },
  };
}

// createFileSystemWatcher returns a Disposable and each onDid* registration
// returns another (vscode.d.ts). None of them was kept, so every activate() left
// a manifest watcher and three listeners behind that deactivate() could not
// release.
test("ProjectFactory releases its manifest watcher on disposal", () => {
  const { createProjectFactory } = require("../src/project/projectFactory");
  const disposals = [];
  const watcher = {
    dispose() {
      disposals.push("watcher");
    },
    onDidCreate() {
      return { dispose() { disposals.push("create"); } };
    },
    onDidChange() {
      return { dispose() { disposals.push("change"); } };
    },
    onDidDelete() {
      return { dispose() { disposals.push("delete"); } };
    },
  };
  const factory = createProjectFactory({
    fileSystem: createFakeFileSystem({}),
    pathModule: path.posix,
    vscode: {
      workspace: {
        createFileSystemWatcher() {
          return watcher;
        },
      },
    },
  });

  assert.equal(typeof factory.dispose, "function");
  factory.dispose();
  factory.dispose();

  assert.deepEqual(disposals.sort(), ["change", "create", "delete", "watcher"]);
});

test("ProjectFactory detects Gauge projects by manifest", () => {
  const { createProjectFactory } = require("../src/project/projectFactory");
  const factory = createProjectFactory({
    fileSystem: createFakeFileSystem({
      "/workspace/gauge/manifest.json": JSON.stringify({ Language: "kotlin" }),
      "/workspace/empty/manifest.json": "{}",
      "/workspace/lowercase/manifest.json": JSON.stringify({ language: "kotlin" }),
      "/workspace/typo/manifest.json": JSON.stringify({ langauge: "kotlin" }),
    }),
    pathModule: path.posix,
  });

  assert.equal(factory.isGaugeProject("/workspace/gauge"), true);
  assert.equal(factory.isGaugeProject("/workspace/empty"), true);
  assert.equal(factory.isGaugeProject("/workspace/lowercase"), true);
  assert.equal(factory.isGaugeProject("/workspace/typo"), true);
  assert.equal(factory.isGaugeProject("/workspace/other"), false);
});

test("ProjectFactory finds nested Gauge project roots", () => {
  const { createProjectFactory } = require("../src/project/projectFactory");
  const factory = createProjectFactory({
    fileSystem: createFakeFileSystem({
      "/workspace/service-a/manifest.json": JSON.stringify({ Language: "kotlin" }),
      "/workspace/services/service-b/manifest.json": JSON.stringify({ Language: "java" }),
      "/workspace/services/not-gauge/manifest.json": "{}",
      "/workspace/node_modules/ignored/manifest.json": JSON.stringify({ Language: "kotlin" }),
    }),
    pathModule: path.posix,
  });

  assert.deepEqual(factory.findGaugeProjectRoots("/workspace"), [
    "/workspace/service-a",
    "/workspace/services/not-gauge",
    "/workspace/services/service-b",
  ]);
  assert.deepEqual(factory.findGaugeProjectRoots("/workspace/service-a"), ["/workspace/service-a"]);
  assert.deepEqual(factory.findGaugeProjectRoots("/workspace/missing"), []);
});

test("ProjectFactory discovers nested roots without synchronous directory I/O", async () => {
  const { createProjectFactory } = require("../src/project/projectFactory");
  const directories = new Map([
    ["/workspace", ["service-a", "tools"]],
    ["/workspace/service-a", ["manifest.json"]],
    ["/workspace/tools", ["service-b"]],
    ["/workspace/tools/service-b", ["manifest.json"]],
  ]);
  const manifests = new Set([
    "/workspace/service-a/manifest.json",
    "/workspace/tools/service-b/manifest.json",
  ]);
  const fileSystem = {
    existsSync() {
      throw new Error("synchronous exists must not run during async discovery");
    },
    readdirSync() {
      throw new Error("synchronous readdir must not run during async discovery");
    },
    statSync() {
      throw new Error("synchronous stat must not run during async discovery");
    },
    promises: {
      async access(filename) {
        if (!manifests.has(filename)) {
          throw new Error(`Missing ${filename}`);
        }
      },
      async readdir(dirname) {
        if (!directories.has(dirname)) {
          throw new Error(`Missing ${dirname}`);
        }
        return directories.get(dirname);
      },
      async stat(filename) {
        return {
          isDirectory() {
            return directories.has(filename);
          },
        };
      },
    },
  };
  const factory = createProjectFactory({ fileSystem, pathModule: path.posix });

  assert.deepEqual(await factory.findGaugeProjectRootsAsync("/workspace"), [
    "/workspace/service-a",
    "/workspace/tools/service-b",
  ]);
});

test("ProjectFactory finds nested Gauge project roots under Gauge roots", () => {
  const { createProjectFactory } = require("../src/project/projectFactory");
  const factory = createProjectFactory({
    fileSystem: createFakeFileSystem({
      "/workspace/gauge/manifest.json": JSON.stringify({ Language: "kotlin" }),
      "/workspace/gauge/build.gradle.kts": "",
      "/workspace/gauge/modules/admin/manifest.json": JSON.stringify({ Language: "kotlin" }),
      "/workspace/gauge/modules/admin/build.gradle.kts": "",
      "/workspace/gauge/modules/admin/specs/example.spec": "",
      "/workspace/gauge/modules/admin/subsystems/reports/manifest.json": JSON.stringify({ Language: "kotlin" }),
      "/workspace/gauge/modules/admin/subsystems/reports/build.gradle.kts": "",
    }),
    pathModule: path.posix,
  });

  assert.deepEqual(factory.findGaugeProjectRoots("/workspace/gauge"), [
    "/workspace/gauge",
    "/workspace/gauge/modules/admin",
    "/workspace/gauge/modules/admin/subsystems/reports",
  ]);
});

test("ProjectFactory creates Kotlin Gradle projects", () => {
  const { createProjectFactory } = require("../src/project/projectFactory");
  const { GradleProject } = require("../src/project/gradleProject");
  const factory = createProjectFactory({
    fileSystem: createFakeFileSystem({
      "/workspace/gauge/manifest.json": JSON.stringify({
        Language: "kotlin",
        Plugins: [{ name: "kotlin" }],
      }),
      "/workspace/gauge/build.gradle.kts": "",
    }),
    pathModule: path.posix,
  });

  const project = factory.get("/workspace/gauge");

  assert.equal(project instanceof GradleProject, true);
  assert.equal(project.language(), "kotlin");
  assert.equal(project.root(), "/workspace/gauge");
});

test("ProjectFactory creates Kotlin Maven projects", () => {
  const { createProjectFactory } = require("../src/project/projectFactory");
  const { MavenProject } = require("../src/project/mavenProject");
  const factory = createProjectFactory({
    fileSystem: createFakeFileSystem({
      "/workspace/gauge/manifest.json": JSON.stringify({
        Language: "kotlin",
        Plugins: [{ name: "kotlin" }],
      }),
      "/workspace/gauge/pom.xml": "",
    }),
    pathModule: path.posix,
  });

  const project = factory.get("/workspace/gauge");

  assert.equal(project instanceof MavenProject, true);
  assert.equal(project.language(), "kotlin");
});

test("ProjectFactory finds project root from a file path", () => {
  const { createProjectFactory } = require("../src/project/projectFactory");
  const factory = createProjectFactory({
    fileSystem: createFakeFileSystem({
      "/workspace/gauge/manifest.json": JSON.stringify({
        Language: "kotlin",
        Plugins: [],
      }),
    }),
    pathModule: path.posix,
  });

  assert.equal(
    factory.getGaugeRootFromFilePath("/workspace/gauge/specs/example.spec"),
    "/workspace/gauge",
  );
});

test("ProjectFactory rejects paths outside Gauge projects", () => {
  const { createProjectFactory } = require("../src/project/projectFactory");
  const factory = createProjectFactory({
    fileSystem: createFakeFileSystem({}),
    pathModule: path.posix,
  });

  assert.throws(
    () => factory.getProjectByFilepath("/workspace/other/specs/example.spec"),
    /does not belong to a valid gauge project/,
  );
});

test("ProjectFactory creates generic Gauge projects without manifest language", () => {
  const { createProjectFactory } = require("../src/project/projectFactory");
  const { GaugeProject } = require("../src/project/gaugeProject");
  const factory = createProjectFactory({
    fileSystem: createFakeFileSystem({
      "/workspace/gauge/manifest.json": "{}",
      "/workspace/gauge/specs/example.spec": "",
    }),
    pathModule: path.posix,
  });

  const project = factory.getProjectByFilepath("/workspace/gauge/specs/example.spec");

  assert.equal(project instanceof GaugeProject, true);
  assert.equal(project.root(), "/workspace/gauge");
  assert.equal(project.language(), undefined);
});

function createCountingFileSystem(entries) {
  const fileSystem = createFakeFileSystem(entries);
  const counts = { existsSync: 0, readFileSync: 0, readdirSync: 0 };
  return {
    counts,
    fileSystem: {
      existsSync(filename) {
        counts.existsSync += 1;
        return fileSystem.existsSync(filename);
      },
      readdirSync(dirname) {
        counts.readdirSync += 1;
        return fileSystem.readdirSync(dirname);
      },
      readFileSync(filename) {
        counts.readFileSync += 1;
        return fileSystem.readFileSync(filename);
      },
      statSync(filename) {
        return fileSystem.statSync(filename);
      },
    },
  };
}

test("ProjectFactory caches project instances until manifests change", () => {
  const { createProjectFactory } = require("../src/project/projectFactory");
  const { counts, fileSystem } = createCountingFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({ Language: "kotlin" }),
  });
  const factory = createProjectFactory({ fileSystem, pathModule: path.posix });

  const first = factory.get("/workspace/gauge");
  const readsAfterFirst = counts.readFileSync;
  const second = factory.get("/workspace/gauge");

  assert.equal(first, second);
  assert.equal(counts.readFileSync, readsAfterFirst);
});

test("ProjectFactory caches root resolution for repeated file lookups", () => {
  const { createProjectFactory } = require("../src/project/projectFactory");
  const { counts, fileSystem } = createCountingFileSystem({
    "/workspace/gauge/manifest.json": JSON.stringify({ Language: "kotlin" }),
    "/workspace/gauge/specs/deep/nested/example.spec": "# Example",
  });
  const factory = createProjectFactory({ fileSystem, pathModule: path.posix });

  const first = factory.getGaugeRootFromFilePath("/workspace/gauge/specs/deep/nested/example.spec");
  const existsAfterFirst = counts.existsSync;
  const second = factory.getGaugeRootFromFilePath("/workspace/gauge/specs/deep/nested/example.spec");

  assert.equal(first, "/workspace/gauge");
  assert.equal(second, "/workspace/gauge");
  assert.equal(counts.existsSync, existsAfterFirst);
});

test("ProjectFactory caches workspace root discovery", () => {
  const { createProjectFactory } = require("../src/project/projectFactory");
  const { counts, fileSystem } = createCountingFileSystem({
    "/workspace/alpha/manifest.json": JSON.stringify({ Language: "kotlin" }),
    "/workspace/beta/manifest.json": JSON.stringify({ Language: "kotlin" }),
  });
  const factory = createProjectFactory({ fileSystem, pathModule: path.posix });

  const first = factory.findGaugeProjectRoots("/workspace");
  const readdirAfterFirst = counts.readdirSync;
  const second = factory.findGaugeProjectRoots("/workspace");

  assert.deepEqual(first, ["/workspace/alpha", "/workspace/beta"]);
  assert.deepEqual(second, first);
  assert.equal(counts.readdirSync, readdirAfterFirst);
});

test("ProjectFactory invalidates caches on manifest watcher events", () => {
  const { createProjectFactory } = require("../src/project/projectFactory");
  const watchers = [];
  const entries = {
    "/workspace/gauge/manifest.json": JSON.stringify({ Language: "kotlin" }),
  };
  const { counts, fileSystem } = createCountingFileSystem(entries);
  const factory = createProjectFactory({
    fileSystem,
    pathModule: path.posix,
    vscode: {
      workspace: {
        createFileSystemWatcher(glob) {
          const watcher = {
            changeListeners: [],
            createListeners: [],
            deleteListeners: [],
            glob,
            onDidChange(listener) {
              watcher.changeListeners.push(listener);
              return { dispose() {} };
            },
            onDidCreate(listener) {
              watcher.createListeners.push(listener);
              return { dispose() {} };
            },
            onDidDelete(listener) {
              watcher.deleteListeners.push(listener);
              return { dispose() {} };
            },
            dispose() {},
          };
          watchers.push(watcher);
          return watcher;
        },
      },
    },
  });

  const first = factory.get("/workspace/gauge");
  assert.equal(watchers.length, 1);
  watchers[0].changeListeners[0]({ fsPath: "/workspace/gauge/manifest.json" });
  const second = factory.get("/workspace/gauge");

  assert.notEqual(first, second);
});

// A hand-edited manifest.json with a trailing comma makes every projectFactory
// caller throw. Each of them catches and treats the folder as "not a Gauge
// project", so the whole Gauge half of the extension turns itself off with no
// message at all. Gauge itself refuses to run and says why.
test("ProjectFactory reports a manifest that is not valid JSON", () => {
  const { createProjectFactory } = require("../src/project/projectFactory");
  const errors = [];
  const factory = createProjectFactory({
    fileSystem: createFakeFileSystem({
      "/workspace/gauge/manifest.json": "{\n  \"Language\": \"java\",\n}\n",
      "/workspace/gauge/build.gradle.kts": "",
    }),
    pathModule: path.posix,
    vscode: {
      window: {
        showErrorMessage(message) {
          errors.push(message);
          return Promise.resolve(undefined);
        },
      },
    },
  });

  assert.throws(() => factory.get("/workspace/gauge"));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^Gauge project manifest is not valid JSON: \/workspace\/gauge\/manifest\.json\./);

  // Reported once per project, not once per caller.
  assert.throws(() => factory.get("/workspace/gauge"));
  assert.equal(errors.length, 1);
});

// A manifest.json that exists but cannot be read - wrong permissions, a broken
// symlink, a directory of that name - fails the same way a syntax error does:
// every caller catches and treats the folder as "not a Gauge project" and the
// extension turns itself off. Only SyntaxError was reported, so this case was
// silent.
test("ProjectFactory reports a manifest it cannot read", () => {
  const { createProjectFactory } = require("../src/project/projectFactory");
  const errors = [];
  const fileSystem = createFakeFileSystem({
    "/workspace/gauge/manifest.json": "{}",
    "/workspace/gauge/build.gradle.kts": "",
  });
  const readFileSync = fileSystem.readFileSync.bind(fileSystem);
  fileSystem.readFileSync = (target, ...rest) => {
    if (String(target).endsWith("manifest.json")) {
      const error = new Error("EACCES: permission denied, open '/workspace/gauge/manifest.json'");
      error.code = "EACCES";
      throw error;
    }
    return readFileSync(target, ...rest);
  };
  const factory = createProjectFactory({
    fileSystem,
    pathModule: path.posix,
    vscode: {
      window: {
        showErrorMessage(message) {
          errors.push(message);
          return Promise.resolve(undefined);
        },
      },
    },
  });

  assert.throws(() => factory.get("/workspace/gauge"));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^Gauge project manifest could not be read: \/workspace\/gauge\/manifest\.json\./);
  assert.match(errors[0], /EACCES/);

  // Reported once per project, not once per caller.
  assert.throws(() => factory.get("/workspace/gauge"));
  assert.equal(errors.length, 1);
});

test("ProjectFactory keeps a valid manifest silent", () => {
  const { createProjectFactory } = require("../src/project/projectFactory");
  const errors = [];
  const factory = createProjectFactory({
    fileSystem: createFakeFileSystem({
      "/workspace/gauge/manifest.json": JSON.stringify({ Language: "java" }),
      "/workspace/gauge/build.gradle.kts": "",
    }),
    pathModule: path.posix,
    vscode: {
      window: {
        showErrorMessage(message) {
          errors.push(message);
          return Promise.resolve(undefined);
        },
      },
    },
  });

  assert.equal(factory.get("/workspace/gauge").language(), "java");
  assert.deepEqual(errors, []);
});
