const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

function taskVscode(exitCode) {
  let processListener;
  const tasks = [];

  class ProcessExecution {
    constructor(process, args, options) {
      this.process = process;
      this.args = args;
      this.options = options;
    }
  }

  class Task {
    constructor(definition, scope, name, source, execution) {
      this.definition = definition;
      this.scope = scope;
      this.name = name;
      this.source = source;
      this.execution = execution;
    }
  }

  return {
    ProcessExecution,
    Task,
    TaskPanelKind: { Dedicated: "dedicated" },
    TaskRevealKind: { Always: "always" },
    TaskScope: { Workspace: "workspace" },
    tasks: {
      onDidEndTaskProcess(listener) {
        processListener = listener;
        return { dispose() {} };
      },
      async executeTask(task) {
        const execution = { task };
        tasks.push(task);
        queueMicrotask(() => processListener({ execution, exitCode }));
        return execution;
      },
    },
    taskRuns: tasks,
  };
}

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

test("MavenProject reveals native Maven preparation output before Gauge execution", async () => {
  const { MavenProject } = require("../src/project/mavenProject");
  const calls = [];
  const vscode = taskVscode(0);
  const project = new MavenProject("/workspace/gauge", {
    Language: "kotlin",
    Plugins: [],
  }, {
    execSync(command, options) {
      calls.push({ command, options });
      return Buffer.from("/workspace/gauge/target/test-classes\n");
    },
    vscode,
  });

  const env = await project.executionEnvsAsync({
    mavenCommand() {
      return { command: "mvn", shellMode: false };
    },
  });

  assert.deepEqual(env, {
    gauge_custom_classpath: "/workspace/gauge/target/test-classes",
  });
  assert.deepEqual(calls, [{
    command: "mvn -q gauge:classpath",
    options: { cwd: "/workspace/gauge" },
  }]);
  assert.equal(vscode.taskRuns.length, 1);
  const [task] = vscode.taskRuns;
  assert.deepEqual(task.definition, { type: "gauge-maven-prepare" });
  assert.equal(task.scope, "workspace");
  assert.equal(task.name, "test-compile");
  assert.equal(task.source, "Maven");
  assert.equal(task.execution.process, "mvn");
  assert.deepEqual(task.execution.args, ["test-compile"]);
  assert.deepEqual(task.execution.options, { cwd: "/workspace/gauge" });
  assert.deepEqual(task.presentationOptions, {
    clear: true,
    echo: false,
    focus: false,
    panel: "dedicated",
    reveal: "always",
    showReuseMessage: false,
  });
});

test("MavenProject stops when the native Maven preparation task fails", async () => {
  const { MavenProject } = require("../src/project/mavenProject");
  const calls = [];
  const vscode = taskVscode(1);
  const errors = [];
  vscode.window = {
    showErrorMessage(message) {
      errors.push(message);
    },
  };
  const project = new MavenProject("/workspace/gauge", {
    Language: "kotlin",
    Plugins: [],
  }, {
    execSync(command, options) {
      calls.push({ command, options });
      return Buffer.from("/workspace/gauge/target/test-classes\n");
    },
    vscode,
  });

  const env = await project.executionEnvsAsync({
    mavenCommand() {
      return { command: "mvn", shellMode: false };
    },
  });

  assert.equal(env, undefined);
  assert.equal(vscode.taskRuns.length, 1);
  assert.deepEqual(calls, []);
  assert.deepEqual(errors, ["Failed to build the project."]);
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
      command: "gradle -q classpath --rerun",
      options: { cwd: "/workspace/gauge" },
    },
  ]);
});

test("GradleProject joins multi-project Gauge classpaths", () => {
  const { GradleProject } = require("../src/project/gradleProject");
  const project = new GradleProject("/workspace/gauge", {
    Language: "kotlin",
    Plugins: [],
  }, {
    execSync() {
      return Buffer.from([
        "/workspace/gauge/build/classes/kotlin/test:/workspace/gauge/build/resources/test",
        "/workspace/gauge/fixtures/build/classes/kotlin/test:/workspace/gauge/fixtures/build/resources/test",
        "",
      ].join("\n"));
    },
    pathModule: path.posix,
  });

  assert.deepEqual(project.envs({
    gradleCommand() {
      return { command: "gradle" };
    },
  }), {
    gauge_custom_classpath: [
      "/workspace/gauge/build/classes/kotlin/test",
      "/workspace/gauge/build/resources/test",
      "/workspace/gauge/fixtures/build/classes/kotlin/test",
      "/workspace/gauge/fixtures/build/resources/test",
    ].join(path.posix.delimiter),
  });
});

test("GradleProject reruns the classpath reporting task", () => {
  const { GradleProject } = require("../src/project/gradleProject");
  const project = new GradleProject("/workspace/gauge", {
    Language: "kotlin",
    Plugins: [],
  });

  assert.equal(project.executionClasspathArgs(), "-q classpath --rerun");
});

test("GradleProject prepares Kotlin classes for direct Gauge execution", () => {
  const { GradleProject } = require("../src/project/gradleProject");
  const calls = [];
  const gaugeCommand = { command: "/tools/gauge" };
  const project = new GradleProject("/workspace/gauge", {
    Language: "kotlin",
    Plugins: [],
  }, {
    execSync(command, options) {
      calls.push({ command, options });
      return Buffer.from("/workspace/gauge/build/classes/kotlin/test\n");
    },
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/gauge/gradlew";
      },
    },
    pathModule: path.posix,
  });
  const cli = {
    gaugeCommand() {
      return gaugeCommand;
    },
    gradleCommand() {
      return { command: "./gradlew" };
    },
  };

  assert.equal(project.getExecutionCommand(cli), gaugeCommand);
  assert.equal(project.executionKind(), "gauge");
  assert.deepEqual(project.executionEnvs(cli), {
    gauge_custom_classpath: "/workspace/gauge/build/classes/kotlin/test",
  });
  assert.deepEqual(calls, [
    {
      command: "./gradlew -q testClasses classpath --rerun",
      options: { cwd: "/workspace/gauge" },
    },
  ]);
});

test("GradleProject uses the wrapper command for builds when the project has a Gradle wrapper", () => {
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

  const command = project.getBuildCommand({
    gradleCommand() {
      return { command: "./gradlew" };
    },
  });

  assert.equal(command.command, "./gradlew");
});

test("GradleProject falls back to the system Gradle build command without a wrapper", () => {
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

  const command = project.getBuildCommand({
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

test("GradleProject resolves its classpath asynchronously without execSync", async () => {
  const { Command } = require("../src/cli");
  const { GradleProject } = require("../src/project/gradleProject");
  const project = new GradleProject("/workspace/gauge", { Language: "kotlin" }, {
    exec(command, options, callback) {
      assert.equal(command, "gradle -q classpath --rerun");
      assert.equal(options.cwd, "/workspace/gauge");
      callback(undefined, Buffer.from("/workspace/classes"));
    },
    execSync() {
      throw new Error("interactive classpath lookup must not use execSync");
    },
    fileSystem: { existsSync() { return false; } },
  });

  const environment = await project.envsAsync({
    gradleCommand() {
      return new Command("gradle");
    },
  });

  assert.deepEqual(environment, { gauge_custom_classpath: "/workspace/classes" });
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

test("GradleProject reports empty classpath output as an error", () => {
  const { GradleProject } = require("../src/project/gradleProject");
  const errors = [];
  const project = new GradleProject("/workspace/gauge", {
    Language: "kotlin",
    Plugins: [],
  }, {
    execSync() {
      return Buffer.from("\n  \n");
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
    "Error calculating project classpath.\t\nThe build tool returned an empty classpath.",
  ]);
});

test("MavenProject includes build tool output in async classpath errors", async () => {
  const { MavenProject } = require("../src/project/mavenProject");
  const errors = [];
  const project = new MavenProject("/workspace/gauge", {
    Language: "kotlin",
    Plugins: [],
  }, {
    exec(command, options, callback) {
      callback(
        new Error("Command failed: mvn -q gauge:classpath"),
        "[ERROR] Failed to execute goal gauge:classpath: UnsupportedClassVersionError\n",
        "",
      );
    },
    vscode: {
      window: {
        showErrorMessage(message) {
          errors.push(message);
        },
      },
    },
  });

  const env = await project.envsAsync({
    mavenCommand() {
      return { command: "mvn" };
    },
  });

  assert.equal(env, undefined);
  assert.deepEqual(errors, [
    "Error calculating project classpath.\t\n"
      + "[ERROR] Failed to execute goal gauge:classpath: UnsupportedClassVersionError",
  ]);
});

test("MavenProject falls back to the exec error message without build tool output", async () => {
  const { MavenProject } = require("../src/project/mavenProject");
  const errors = [];
  const project = new MavenProject("/workspace/gauge", {
    Language: "kotlin",
    Plugins: [],
  }, {
    exec(command, options, callback) {
      callback(new Error("Command failed: mvn -q gauge:classpath"), "", "");
    },
    vscode: {
      window: {
        showErrorMessage(message) {
          errors.push(message);
        },
      },
    },
  });

  const env = await project.envsAsync({
    mavenCommand() {
      return { command: "mvn" };
    },
  });

  assert.equal(env, undefined);
  assert.deepEqual(errors, [
    "Error calculating project classpath.\t\nCommand failed: mvn -q gauge:classpath",
  ]);
});

test("GradleProject reports empty async classpath output as an error", async () => {
  const { GradleProject } = require("../src/project/gradleProject");
  const errors = [];
  const project = new GradleProject("/workspace/gauge", {
    Language: "kotlin",
    Plugins: [],
  }, {
    exec(command, options, callback) {
      callback(undefined, "");
    },
    vscode: {
      window: {
        showErrorMessage(message) {
          errors.push(message);
        },
      },
    },
  });

  const env = await project.envsAsync({
    gradleCommand() {
      return { command: "gradle" };
    },
  });

  assert.equal(env, undefined);
  assert.deepEqual(errors, [
    "Error calculating project classpath.\t\nThe build tool returned an empty classpath.",
  ]);
});

test("MavenProject reports a missing build tool command from the async classpath path", async () => {
  const { MavenProject } = require("../src/project/mavenProject");
  const errors = [];
  const project = new MavenProject("/workspace/gauge", {
    Language: "kotlin",
    Plugins: [],
  }, {
    exec() {
      throw new Error("a missing build tool must not be spawned");
    },
    vscode: {
      window: {
        showErrorMessage(message) {
          errors.push(message);
        },
      },
    },
  });

  const env = await project.envsAsync({
    mavenCommand() {
      return undefined;
    },
  });

  assert.equal(env, undefined);
  assert.deepEqual(errors, [
    "Error calculating project classpath.\t\nBuild tool command is not available.",
  ]);
});

function terminatedTaskVscode() {
  let processListener;
  let taskListener;
  const disposals = [];

  class ProcessExecution {
    constructor(process, args, options) {
      this.process = process;
      this.args = args;
      this.options = options;
    }
  }

  class Task {
    constructor(definition, scope, name, source, execution) {
      this.definition = definition;
      this.scope = scope;
      this.name = name;
      this.source = source;
      this.execution = execution;
    }
  }

  return {
    ProcessExecution,
    Task,
    TaskPanelKind: { Dedicated: "dedicated" },
    TaskRevealKind: { Always: "always" },
    TaskScope: { Workspace: "workspace" },
    disposals,
    tasks: {
      onDidEndTaskProcess(listener) {
        processListener = listener;
        return { dispose() { disposals.push("process"); } };
      },
      onDidEndTask(listener) {
        taskListener = listener;
        return { dispose() { disposals.push("task"); } };
      },
      async executeTask(task) {
        // A task that runs no underlying process reports no process exit, so
        // only the task end event arrives.
        const execution = { task };
        queueMicrotask(() => taskListener({ execution }));
        return execution;
      },
    },
    unusedProcessListener: () => processListener,
  };
}

test("MavenProject settles the build when the task ends without a process exit", async () => {
  const { MavenProject } = require("../src/project/mavenProject");
  const vscode = terminatedTaskVscode();
  const project = new MavenProject("/workspace/gauge", {
    Language: "kotlin",
    Plugins: [],
  }, {
    exec(command, options, callback) {
      callback(undefined, Buffer.from("/workspace/gauge/target/test-classes\n"));
    },
    vscode,
  });

  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve("timed out"), 200).unref();
  });
  const result = await Promise.race([
    project.executionEnvsAsync({
      mavenCommand() {
        return { command: "mvn", shellMode: false };
      },
    }),
    timeout,
  ]);

  assert.equal(result, undefined);
  assert.deepEqual(vscode.disposals.sort(), ["process", "task"]);
});
