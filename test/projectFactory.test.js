const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

function createFakeFileSystem(entries) {
  const files = new Map(Object.entries(entries));
  return {
    existsSync(filename) {
      return files.has(filename);
    },
    readFileSync(filename) {
      if (!files.has(filename)) {
        throw new Error(`Missing ${filename}`);
      }
      return Buffer.from(files.get(filename));
    },
  };
}

test("ProjectFactory detects Gauge projects by manifest", () => {
  const { createProjectFactory } = require("../src/project/projectFactory");
  const factory = createProjectFactory({
    fileSystem: createFakeFileSystem({
      "/workspace/gauge/manifest.json": "{}",
    }),
    pathModule: path.posix,
  });

  assert.equal(factory.isGaugeProject("/workspace/gauge"), true);
  assert.equal(factory.isGaugeProject("/workspace/other"), false);
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
