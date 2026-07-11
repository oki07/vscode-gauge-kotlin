const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

test("GaugeProject detects files inside the project root", () => {
  const { GaugeProject } = require("../src/project/gaugeProject");
  const project = new GaugeProject("/workspace/gauge", {
    Language: "kotlin",
    Plugins: [],
  });

  assert.equal(project.hasFile("/workspace/gauge/specs/example.spec"), true);
  assert.equal(project.hasFile("/workspace/gauge"), true);
  assert.equal(project.hasFile("/workspace/other/specs/example.spec"), false);
});

test("GaugeProject returns a plain JVM project custom classpath environment", () => {
  const { GaugeProject } = require("../src/project/gaugeProject");
  const directories = new Set([
    "/workspace/gauge/src/test/kotlin",
    "/workspace/gauge/out/test/gauge",
    "/workspace/gauge/out/production/gauge",
    "/workspace/gauge/libs",
    "/workspace/gauge/libs/nested",
    "/gauge/plugins/kotlin/0.9.0/libs",
  ]);
  const files = new Set([
    "/workspace/gauge/libs/project.jar",
    "/workspace/gauge/libs/nested/helper.jar",
    "/workspace/gauge/libs/readme.txt",
    "/gauge/plugins/kotlin/0.9.0/libs/gauge-kotlin.jar",
  ]);
  const fileSystem = {
    existsSync(filename) {
      return directories.has(filename) || files.has(filename);
    },
    readdirSync(dirname) {
      if (dirname === "/workspace/gauge/libs") {
        return ["project.jar", "nested", "readme.txt"];
      }
      if (dirname === "/workspace/gauge/libs/nested") {
        return ["helper.jar"];
      }
      if (dirname === "/gauge/plugins/kotlin/0.9.0/libs") {
        return ["gauge-kotlin.jar"];
      }
      return [];
    },
    statSync(filename) {
      return {
        isDirectory() {
          return directories.has(filename);
        },
      };
    },
  };
  const project = new GaugeProject("/workspace/gauge", {
    Language: "kotlin",
    Plugins: [],
  }, {
    fileSystem,
    gaugeConfig: {
      pluginsPath() {
        return "/gauge/plugins";
      },
    },
    pathModule: {
      ...require("node:path").posix,
      delimiter: ":",
    },
  });

  const env = project.envs({
    getGaugePluginVersion(language) {
      assert.equal(language, "kotlin");
      return "0.9.0";
    },
  });

  assert.deepEqual(env, {
    gauge_custom_classpath: [
      "/workspace/gauge/src/test/kotlin",
      "/workspace/gauge/out/test/gauge",
      "/workspace/gauge/out/production/gauge",
      "/workspace/gauge/libs/project.jar",
      "/workspace/gauge/libs/nested/helper.jar",
      "/gauge/plugins/kotlin/0.9.0/libs/gauge-kotlin.jar",
    ].join(":"),
  });
});

test("MavenProject returns Gauge custom classpath environment", () => {
  const { MavenProject } = require("../src/project/mavenProject");
  const calls = [];
  const project = new MavenProject("/workspace/gauge", {
    Language: "kotlin",
    Plugins: [],
  }, {
    execSync(command, options) {
      calls.push({ command, options });
      return Buffer.from("/workspace/gauge/target/classes\n");
    },
  });

  const env = project.envs({
    mavenCommand() {
      return { command: "mvn" };
    },
  });

  assert.deepEqual(env, {
    gauge_custom_classpath: "/workspace/gauge/target/classes",
  });
  assert.deepEqual(calls, [
    {
      command: "mvn -q gauge:classpath",
      options: { cwd: "/workspace/gauge" },
    },
  ]);
});

test("MavenProject prepares test classes before direct Gauge execution", () => {
  const { MavenProject } = require("../src/project/mavenProject");
  const calls = [];
  const gaugeCommand = { command: "gauge" };
  const project = new MavenProject("/workspace/gauge", {
    Language: "kotlin",
    Plugins: [],
  }, {
    execSync(command, options) {
      calls.push({ command, options });
      return Buffer.from([
        "SLF4J(W): No SLF4J providers were found.",
        "No errors found.",
        "/workspace/gauge/target/test-classes",
        "",
      ].join("\n"));
    },
  });
  const cli = {
    gaugeCommand() {
      return gaugeCommand;
    },
    mavenCommand() {
      return { command: "mvn" };
    },
  };

  assert.equal(project.getExecutionCommand(cli), gaugeCommand);
  assert.equal(project.executionKind(), "gauge");
  assert.deepEqual(project.executionEnvs(cli), {
    gauge_custom_classpath: "/workspace/gauge/target/test-classes",
  });
  assert.deepEqual(calls, [
    {
      command: "mvn -q test-compile gauge:classpath",
      options: { cwd: "/workspace/gauge" },
    },
  ]);
});

test("MavenProject reports classpath calculation errors", () => {
  const { MavenProject } = require("../src/project/mavenProject");
  const errors = [];
  const project = new MavenProject("/workspace/gauge", {
    Language: "kotlin",
    Plugins: [],
  }, {
    execSync() {
      throw { output: Buffer.from("Error message.") };
    },
    vscode: {
      window: {
        showErrorMessage(message) {
          errors.push(message);
        },
      },
    },
  });

  const env = project.envs({
    mavenCommand() {
      return { command: "mvn" };
    },
  });

  assert.equal(env, undefined);
  assert.deepEqual(errors, [
    "Error calculating project classpath.\t\nError message.",
  ]);
});

test("GradleProject returns Gauge custom classpath environment", () => {
  const { GradleProject } = require("../src/project/gradleProject");
  const calls = [];
  const project = new GradleProject("/workspace/gauge", {
    Language: "kotlin",
    Plugins: [],
  }, {
    execSync(command, options) {
      calls.push({ command, options });
      return Buffer.from("/workspace/gauge/build/classes\n");
    },
  });

  const env = project.envs({
    gradleCommand() {
      return { command: "gradle" };
    },
  });

  assert.deepEqual(env, {
    gauge_custom_classpath: "/workspace/gauge/build/classes",
  });
  assert.deepEqual(calls, [
    {
      command: "gradle -q clean classpath",
      options: { cwd: "/workspace/gauge" },
    },
  ]);
});

test("GradleProject uses the wrapper command when the project has a Gradle wrapper", () => {
  const { GradleProject } = require("../src/project/gradleProject");
  const project = new GradleProject("/workspace/gauge", {
    Language: "kotlin",
    Plugins: [],
  }, {
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/gauge/gradlew";
      },
    },
    pathModule: path.posix,
  });

  const command = project.getExecutionCommand({
    gradleCommand() {
      return { command: "./gradlew" };
    },
  });

  assert.equal(command.command, "./gradlew");
});

test("GradleProject falls back to the system Gradle command without a wrapper", () => {
  const { GradleProject } = require("../src/project/gradleProject");
  const project = new GradleProject("/workspace/gauge", {
    Language: "kotlin",
    Plugins: [],
  }, {
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    pathModule: path.posix,
  });

  const command = project.getExecutionCommand({
    gradleCommand() {
      return { command: "./gradlew" };
    },
  });

  assert.equal(command.command, "gradle");
});

test("build project envs report classpath calculation errors", () => {
  const { GradleProject } = require("../src/project/gradleProject");
  const errors = [];
  const project = new GradleProject("/workspace/gauge", {
    Language: "kotlin",
    Plugins: [],
  }, {
    execSync() {
      throw { output: Buffer.from("Error message.") };
    },
    vscode: {
      window: {
        showErrorMessage(message) {
          errors.push(message);
        },
      },
    },
  });

  const env = project.envs({
    gradleCommand() {
      return { command: "gradle" };
    },
  });

  assert.equal(env, undefined);
  assert.deepEqual(errors, [
    "Error calculating project classpath.\t\nError message.",
  ]);
});

test("build project envs report missing build tool commands", () => {
  const { MavenProject } = require("../src/project/mavenProject");
  const errors = [];
  const project = new MavenProject("/workspace/gauge", {
    Language: "kotlin",
    Plugins: [],
  }, {
    execSync() {
      throw new Error("execSync should not run without a command");
    },
    vscode: {
      window: {
        showErrorMessage(message) {
          errors.push(message);
        },
      },
    },
  });

  assert.doesNotThrow(() => {
    const env = project.envs({
      mavenCommand() {
        return undefined;
      },
    });
    assert.equal(env, undefined);
  });
  assert.deepEqual(errors, [
    "Error calculating project classpath.\t\nBuild tool command is not available.",
  ]);
});

test("GaugeProject compares by class and root", () => {
  const { GaugeProject } = require("../src/project/gaugeProject");
  const { GradleProject } = require("../src/project/gradleProject");
  const manifest = { Language: "kotlin", Plugins: [] };

  assert.equal(new GaugeProject("/workspace/gauge", manifest).equals(
    new GaugeProject("/workspace/gauge", manifest),
  ), true);
  assert.equal(new GradleProject("/workspace/gauge", manifest).equals(
    new GaugeProject("/workspace/gauge", manifest),
  ), false);
  assert.equal(new GaugeProject("/workspace/gauge", manifest).equals(
    new GaugeProject("/workspace/other", manifest),
  ), false);
});
