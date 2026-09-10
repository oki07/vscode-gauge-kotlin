"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { MavenProject } = require("../src/project/mavenProject");
const { ProjectEnvironmentService } = require("../src/projectEnvironmentService");
const cases = require("./fixtures/maven-preparation-parity.json");

// Gauge 1.6.35 with Java 1.0.1 loads compiled Kotlin classes: an external
// source edit produces exit 1 with cached classes and exit 0 after Maven
// test-compile, including a custom testSourceDirectory. The unchanged-source
// control exits 0 with either preparation. Maven owns incremental compilation.
for (const fixture of cases) {
  test(`Maven preparation: ${fixture.name}`, async () => {
    let sourceVersion = "first";
    let compiledVersion;
    let compiles = 0;
    let classpaths = 0;
    const project = new MavenProject("/workspace/gauge", { Language: "kotlin" }, {
      pathModule: path.posix,
      fileSystem: { existsSync: () => false },
      execSync(command) {
        if (command.includes("test-compile")) {
          compiles += 1;
          compiledVersion = sourceVersion;
          return Buffer.from("");
        }
        assert.equal(command, "mvn -q gauge:classpath");
        classpaths += 1;
        return Buffer.from("/workspace/gauge/target/test-classes");
      },
    });
    const service = new ProjectEnvironmentService({
      cli: { mavenCommand: () => ({ command: "mvn" }) },
      vscode: {},
    });
    try {
      await service.executionEnvironmentFor(project);
      assert.equal(compiledVersion, "first");
      if (fixture.change === "edit") {
        sourceVersion = "second";
      } else if (fixture.change === "remove-output") {
        compiledVersion = undefined;
      }
      // External tools need not deliver an editor save or file watcher event.
      await service.executionEnvironmentFor(project);
      assert.equal(compiledVersion, sourceVersion);
      assert.equal(compiles, 2);
      assert.equal(classpaths, 1);
    } finally {
      service.dispose();
    }
  });
}
