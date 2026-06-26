const assert = require("node:assert/strict");
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
