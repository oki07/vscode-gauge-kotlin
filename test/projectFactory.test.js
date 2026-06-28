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
  assert.equal(factory.isGaugeProject("/workspace/empty"), false);
  assert.equal(factory.isGaugeProject("/workspace/lowercase"), false);
  assert.equal(factory.isGaugeProject("/workspace/typo"), false);
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
    "/workspace/services/service-b",
  ]);
  assert.deepEqual(factory.findGaugeProjectRoots("/workspace/service-a"), ["/workspace/service-a"]);
  assert.deepEqual(factory.findGaugeProjectRoots("/workspace/missing"), []);
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

test("ProjectFactory rejects paths inside manifests without Gauge language", () => {
  const { createProjectFactory } = require("../src/project/projectFactory");
  const factory = createProjectFactory({
    fileSystem: createFakeFileSystem({
      "/workspace/not-gauge/manifest.json": "{}",
      "/workspace/not-gauge/specs/example.spec": "",
    }),
    pathModule: path.posix,
  });

  assert.throws(
    () => factory.getProjectByFilepath("/workspace/not-gauge/specs/example.spec"),
    /does not belong to a valid gauge project/,
  );
});
