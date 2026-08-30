const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const test = require("node:test");

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });
  return { promise, reject, resolve };
}

function createFakeVscode(overrides = {}) {
  const commands = [];
  const errors = [];
  const errorActions = [];
  const inputs = [];
  const progressReports = [];
  const quickPicks = [];
  const openDialogs = [];
  const registered = [];
  const vscode = {
    Uri: {
      file(filename) {
        return { fsPath: filename };
      },
    },
    commands: {
      executeCommand(command, ...args) {
        commands.push({ command, args });
        return Promise.resolve(undefined);
      },
      registerCommand(command, handler) {
        registered.push({ command, handler });
        return { dispose() {} };
      },
    },
    window: {
      showErrorMessage(message, ...actions) {
        errors.push(message);
        errorActions.push(actions);
        return Promise.resolve(undefined);
      },
      showInputBox(options) {
        inputs.push(options);
        return Promise.resolve(overrides.projectName || "shop");
      },
      showOpenDialog(options) {
        openDialogs.push(options);
        return Promise.resolve([{ fsPath: "/workspace" }]);
      },
      showQuickPick(items) {
        quickPicks.push(items);
        return Promise.resolve(items[0]);
      },
      withProgress(options, task) {
        progressReports.push({ options });
        return task({
          report(message) {
            progressReports.push(message);
          },
        });
      },
    },
    workspace: {
      workspaceFolders: overrides.workspaceFolders || [{ uri: { fsPath: "/workspace" } }],
      getConfiguration(section) {
        return {
          get(key) {
            if (section === "gauge.kotlin" && key === "template") {
              return overrides.kotlinTemplate;
            }
            return undefined;
          },
        };
      },
    },
  };
  return {
    commands,
    errorActions,
    errors,
    inputs,
    openDialogs,
    progressReports,
    quickPicks,
    registered,
    vscode,
  };
}

function createChildProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  return child;
}

// A scaffolded project must have a terminal entry point that WORKS. `gauge run
// specs` is not it for a build-tool project: gauge-java compiles only *.java
// from src/test/java into gauge_bin and puts only gauge_bin on the classpath, so
// a Kotlin project's steps are invisible and every step reports "Step
// implementation not found". The stock java_maven and java_gradle templates
// ship the same empty gauge_custom_build_path and document the BUILD TOOL
// instead.
//
// Verified by running real Maven against the generated pom: with no <execution>
// binding a goal to a phase, `mvn -B clean test` reports BUILD SUCCESS having
// executed no specification at all. Adding a bare execution makes it run them
// (gauge-maven-plugin's execute mojo already defaults to the test phase).
test("the bundled templates document a terminal entry point that works", () => {
  const {
    listBundledKotlinTemplates,
    writeBundledKotlinTemplate,
  } = require("../src/init/bundledKotlinTemplates");
  const written = new Map();
  const fileSystem = {
    existsSync: () => false,
    mkdirSync() {},
    writeFileSync(file, content) {
      written.set(String(file), String(content));
    },
  };
  const fileFor = (label, suffix) => {
    written.clear();
    writeBundledKotlinTemplate({
      fileSystem,
      pathModule: path.posix,
      projectRoot: "/p",
      projectName: "demo",
      template: listBundledKotlinTemplates().find((entry) => entry.label === label),
    });
    return [...written.entries()].find(([file]) => file.endsWith(suffix))[1];
  };

  const pom = fileFor("kotlin_maven", "pom.xml");
  assert.match(pom, /<executions>[\s\S]*<goal>execute<\/goal>[\s\S]*<\/executions>/);

  for (const [label, command] of [["kotlin_maven", "mvn"], ["kotlin_gradle", "gradle"]]) {
    const readme = fileFor(label, "README.md");
    assert.equal(readme.includes("`gauge run specs` from a terminal"), false, label);
    assert.match(readme, new RegExp(command), label);
  }

  for (const label of ["kotlin_maven", "kotlin_gradle"]) {
    assert.match(fileFor(label, ".gitignore"), /gauge_bin\//, label);
  }
});

test("ProjectInitializer creates a Gauge project from the selected template", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");
  const {
    commands,
    inputs,
    openDialogs,
    progressReports,
    quickPicks,
    registered,
    vscode,
  } = createFakeVscode();
  const mkdirs = [];
  const spawns = [];
  const child = createChildProcess();
  const cli = {
    isGaugeInstalled() {
      return true;
    },
    gaugeCommand() {
      return {
        spawn(args, options) {
          spawns.push({ args, options });
          setImmediate(() => child.emit("close", 0));
          return child;
        },
        spawnSync(args) {
          assert.deepEqual(args, ["template", "--list", "--machine-readable"]);
          return {
            stdout: Buffer.from(JSON.stringify([
              { key: "kotlin", Description: "Kotlin", value: "kotlin" },
            ])),
          };
        },
      };
    },
  };

  new ProjectInitializer({
    cli,
    env: { PATH: "/bin" },
    fileSystem: {
      existsSync(filename) {
        assert.equal(filename, "/workspace/shop");
        return false;
      },
      readFileSync(filename) {
        assert.equal(filename, "/workspace/shop/manifest.json");
        return Buffer.from(JSON.stringify({ Language: "kotlin" }));
      },
      mkdirSync(filename) {
        mkdirs.push(filename);
      },
      removeSync() {},
    },
    pathModule: path.posix,
    vscode,
  });

  const command = registered.find((entry) => entry.command === "gauge.createProject");
  await command.handler();

  assert.deepEqual(quickPicks[0][0], { label: "kotlin", description: "Kotlin", value: "kotlin" });
  assert.deepEqual(quickPicks[0].map((template) => template.label), [
    "kotlin",
    "kotlin_gradle",
    "kotlin_maven",
  ]);
  assert.deepEqual(openDialogs[0], {
    canSelectFolders: true,
    openLabel: "Select a folder to create the project in",
    canSelectMany: false,
  });
  assert.deepEqual(inputs[0], {
    prompt: "Enter a name for your new project",
    placeHolder: "gauge-tests",
  });
  assert.deepEqual(mkdirs, ["/workspace/shop"]);
  assert.deepEqual(progressReports[1], { message: "Initializing project..." });
  assert.deepEqual(spawns, [
    {
      args: ["init", "kotlin"],
      options: { cwd: "/workspace/shop", env: { PATH: "/bin" } },
    },
  ]);
  assert.deepEqual(commands, [
    {
      command: "vscode.openFolder",
      args: [{ fsPath: "/workspace/shop" }, true],
    },
  ]);
});

test("ProjectInitializer reports official install guidance when Gauge is unavailable", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");
  const {
    errorActions,
    errors,
    inputs,
    openDialogs,
    quickPicks,
    registered,
    vscode,
  } = createFakeVscode();
  const cli = {
    isGaugeInstalled() {
      return false;
    },
  };

  new ProjectInitializer({
    cli,
    fileSystem: {
      existsSync() {
        return false;
      },
      mkdirSync() {},
      removeSync() {},
    },
    pathModule: path.posix,
    vscode,
  });

  const command = registered.find((entry) => entry.command === "gauge.createProject");
  await command.handler();

  assert.deepEqual(errors, [
    "Please install gauge to create a new Gauge project.For more info please refer the [install intructions](https://docs.gauge.org/getting_started/installing-gauge.html).",
  ]);
  assert.deepEqual(errorActions, [[]]);
  assert.deepEqual(quickPicks, []);
  assert.deepEqual(openDialogs, []);
  assert.deepEqual(inputs, []);
});

test("ProjectInitializer rejects an existing Gauge project directory without removing it", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");
  const {
    commands,
    errors,
    inputs,
    openDialogs,
    quickPicks,
    registered,
    vscode,
  } = createFakeVscode();
  const mkdirs = [];
  const removes = [];
  const spawns = [];
  const cli = {
    isGaugeInstalled() {
      return true;
    },
    gaugeCommand() {
      return {
        spawn(args) {
          spawns.push(args);
          return createChildProcess();
        },
        spawnSync() {
          return {
            stdout: Buffer.from(JSON.stringify([
              { key: "kotlin", Description: "Kotlin", value: "kotlin" },
            ])),
          };
        },
      };
    },
  };

  new ProjectInitializer({
    cli,
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/shop"
          || filename === "/workspace/shop/manifest.json";
      },
      readFileSync(filename) {
        assert.equal(filename, "/workspace/shop/manifest.json");
        return Buffer.from(JSON.stringify({ Language: "kotlin" }));
      },
      mkdirSync(filename) {
        mkdirs.push(filename);
      },
      removeSync(filename) {
        removes.push(filename);
      },
    },
    pathModule: path.posix,
    vscode,
  });

  const command = registered.find((entry) => entry.command === "gauge.createProject");
  await command.handler();

  assert.deepEqual(quickPicks[0][0], { label: "kotlin", description: "Kotlin", value: "kotlin" });
  assert.deepEqual(quickPicks[0].map((template) => template.label), [
    "kotlin",
    "kotlin_gradle",
    "kotlin_maven",
  ]);
  assert.deepEqual(openDialogs[0], {
    canSelectFolders: true,
    openLabel: "Select a folder to create the project in",
    canSelectMany: false,
  });
  assert.deepEqual(inputs[0], {
    prompt: "Enter a name for your new project",
    placeHolder: "gauge-tests",
  });
  assert.deepEqual(errors, [
    "Given location is already a Gauge Project. Please try to initialize a Gauge project in a different location.",
  ]);
  assert.deepEqual(mkdirs, []);
  assert.deepEqual(removes, []);
  assert.deepEqual(spawns, []);
  assert.deepEqual(commands, []);
});

test("ProjectInitializer treats existing manifests without Gauge language as Gauge directories", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");
  const {
    commands,
    errors,
    registered,
    vscode,
  } = createFakeVscode();
  const mkdirs = [];
  const removes = [];
  const spawns = [];
  const cli = {
    isGaugeInstalled() {
      return true;
    },
    gaugeCommand() {
      return {
        spawn(args) {
          spawns.push(args);
          return createChildProcess();
        },
        spawnSync() {
          return {
            stdout: Buffer.from(JSON.stringify([
              { key: "kotlin", Description: "Kotlin", value: "kotlin" },
            ])),
          };
        },
      };
    },
  };

  new ProjectInitializer({
    cli,
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/shop"
          || filename === "/workspace/shop/manifest.json";
      },
      readFileSync(filename) {
        assert.equal(filename, "/workspace/shop/manifest.json");
        return Buffer.from("{}");
      },
      mkdirSync(filename) {
        mkdirs.push(filename);
      },
      removeSync(filename) {
        removes.push(filename);
      },
    },
    pathModule: path.posix,
    vscode,
  });

  const command = registered.find((entry) => entry.command === "gauge.createProject");
  await command.handler();

  assert.deepEqual(errors, [
    "Given location is already a Gauge Project. Please try to initialize a Gauge project in a different location.",
  ]);
  assert.deepEqual(mkdirs, []);
  assert.deepEqual(removes, []);
  assert.deepEqual(spawns, []);
  assert.deepEqual(commands, []);
});

test("ProjectInitializer rejects an existing non-Gauge directory without removing it", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");
  const {
    commands,
    errors,
    registered,
    vscode,
  } = createFakeVscode();
  const mkdirs = [];
  const removes = [];
  const spawns = [];
  const child = createChildProcess();
  const cli = {
    isGaugeInstalled() {
      return true;
    },
    gaugeCommand() {
      return {
        spawn(args, options) {
          spawns.push({ args, options });
          setImmediate(() => child.emit("close", 0));
          return child;
        },
        spawnSync() {
          return {
            stdout: Buffer.from(JSON.stringify([
              { key: "kotlin", Description: "Kotlin", value: "kotlin" },
            ])),
          };
        },
      };
    },
  };

  new ProjectInitializer({
    cli,
    env: { PATH: "/bin" },
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/shop";
      },
      mkdirSync(filename) {
        mkdirs.push(filename);
      },
      removeSync(filename) {
        removes.push(filename);
      },
    },
    pathModule: path.posix,
    vscode,
  });

  const command = registered.find((entry) => entry.command === "gauge.createProject");
  await command.handler();

  assert.deepEqual(errors, ["A folder named shop already exists in /workspace"]);
  assert.deepEqual(mkdirs, []);
  assert.deepEqual(removes, []);
  assert.deepEqual(spawns, []);
  assert.deepEqual(commands, []);
});

test("ProjectInitializer rejects unsupported Gauge versions before reading templates", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");
  const {
    errors,
    inputs,
    openDialogs,
    quickPicks,
    registered,
    vscode,
  } = createFakeVscode();
  const cli = {
    isGaugeInstalled() {
      return true;
    },
    isGaugeVersionGreaterOrEqual(version) {
      assert.equal(version, "0.9.6");
      return false;
    },
    gaugeCommand() {
      return {
        spawnSync() {
          return {
            stdout: Buffer.from(JSON.stringify([
              { key: "kotlin", Description: "Kotlin", value: "kotlin" },
            ])),
          };
        },
      };
    },
  };

  new ProjectInitializer({
    cli,
    fileSystem: {
      existsSync() {
        return false;
      },
      mkdirSync() {},
      removeSync() {},
    },
    pathModule: path.posix,
    vscode,
  });

  const command = registered.find((entry) => entry.command === "gauge.createProject");
  await command.handler();

  assert.deepEqual(errors, [
    "This version of Gauge Kotlin only works with Gauge version >= 0.9.6",
  ]);
  assert.deepEqual(quickPicks, []);
  assert.deepEqual(openDialogs, []);
  assert.deepEqual(inputs, []);
});

test("ProjectInitializer removes the project directory when Gauge init fails", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");
  const {
    errors,
    registered,
    vscode,
  } = createFakeVscode();
  const mkdirs = [];
  const removes = [];
  const child = createChildProcess();
  const cli = {
    isGaugeInstalled() {
      return true;
    },
    gaugeCommand() {
      return {
        spawn() {
          setImmediate(() => child.emit("close", 1));
          return child;
        },
        spawnSync() {
          return {
            stdout: Buffer.from(JSON.stringify([
              { key: "kotlin", Description: "Kotlin", value: "kotlin" },
            ])),
          };
        },
      };
    },
  };

  new ProjectInitializer({
    cli,
    env: { PATH: "/bin" },
    fileSystem: {
      existsSync(filename) {
        assert.equal(filename, "/workspace/shop");
        return false;
      },
      mkdirSync(filename) {
        mkdirs.push(filename);
      },
      removeSync(filename) {
        removes.push(filename);
      },
    },
    pathModule: path.posix,
    vscode,
  });

  const command = registered.find((entry) => entry.command === "gauge.createProject");
  await assert.rejects(
    () => command.handler(),
    /Failed to initialize project\./,
  );

  assert.deepEqual(mkdirs, ["/workspace/shop"]);
  assert.deepEqual(removes, ["/workspace/shop"]);
  assert.deepEqual(errors, ["Failed to initialize project."]);
});

test("ProjectInitializer does not open the project directory after Gauge init spawn errors", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");
  const {
    commands,
    errors,
    registered,
    vscode,
  } = createFakeVscode();
  const removes = [];
  const child = createChildProcess();
  const cli = {
    isGaugeInstalled() {
      return true;
    },
    gaugeCommand() {
      return {
        spawn() {
          setImmediate(() => {
            child.emit("error", new Error("spawn failed"));
            child.emit("close", 0);
          });
          return child;
        },
        spawnSync() {
          return {
            stdout: Buffer.from(JSON.stringify([
              { key: "kotlin", Description: "Kotlin", value: "kotlin" },
            ])),
          };
        },
      };
    },
  };

  new ProjectInitializer({
    cli,
    fileSystem: {
      existsSync() {
        return false;
      },
      mkdirSync() {},
      removeSync(filename) {
        removes.push(filename);
      },
    },
    pathModule: path.posix,
    vscode,
  });

  const command = registered.find((entry) => entry.command === "gauge.createProject");
  await assert.rejects(
    () => command.handler(),
    /Failed to create template\. spawn failed/,
  );

  assert.deepEqual(removes, ["/workspace/shop"]);
  assert.deepEqual(errors, ["Failed to create template. spawn failed"]);
  assert.deepEqual(commands, []);
});

test("ProjectInitializer offers only Kotlin project templates by configured preference", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");
  const {
    quickPicks,
    registered,
    vscode,
  } = createFakeVscode({ kotlinTemplate: "gradle" });
  const spawns = [];
  const child = createChildProcess();
  const cli = {
    isGaugeInstalled() {
      return true;
    },
    gaugeCommand() {
      return {
        spawn(args) {
          spawns.push(args);
          setImmediate(() => child.emit("close", 0));
          return child;
        },
        spawnSync() {
          return {
            stdout: Buffer.from(JSON.stringify([
              { key: "java", Description: "Java", value: "java" },
              { key: "kotlin_maven", Description: "Kotlin Maven", value: "kotlin_maven" },
              { key: "kotlin_gradle", Description: "Kotlin Gradle", value: "kotlin_gradle" },
            ])),
          };
        },
      };
    },
  };

  new ProjectInitializer({
    cli,
    fileSystem: {
      existsSync() {
        return false;
      },
      readFileSync(filename) {
        assert.equal(filename, "/workspace/shop/manifest.json");
        return Buffer.from(JSON.stringify({ Language: "kotlin" }));
      },
      mkdirSync() {},
      removeSync() {},
    },
    pathModule: path.posix,
    vscode,
  });

  const command = registered.find((entry) => entry.command === "gauge.createProject");
  await command.handler();

  assert.equal(quickPicks[0][0].label, "kotlin_gradle");
  assert.deepEqual(quickPicks[0].map((template) => template.label), [
    "kotlin_gradle",
    "kotlin_maven",
  ]);
  assert.deepEqual(spawns, [["init", "kotlin_gradle"]]);
});

// Gauge publishes no Kotlin template. references/gauge/template/template.go
// defaults() seeds dotnet, java, java_gradle, java_maven, java_maven_selenium,
// js, js_simple, python, python_selenium, ruby, ruby_selenium and ts, and the
// list only grows through an explicit `gauge template <name> <url>` this
// extension never issues. Without a bundled scaffold gauge.createProject - a
// palette command and one of only two onCommand activation events - can never
// succeed.
function createStockGaugeCli(spawns, child) {
  return {
    isGaugeInstalled() {
      return true;
    },
    gaugeCommand() {
      return {
        spawn(args, options) {
          spawns.push({ args, options });
          setImmediate(() => child.emit("close", 0));
          return child;
        },
        spawnSync() {
          return {
            stdout: Buffer.from(JSON.stringify([
              { key: "dotnet", Description: "Dotnet", value: "dotnet" },
              { key: "java", Description: "Java", value: "java" },
              { key: "java_gradle", Description: "Java Gradle", value: "java_gradle" },
              { key: "java_maven", Description: "Java Maven", value: "java_maven" },
              { key: "js", Description: "JavaScript", value: "js" },
              { key: "python", Description: "Python", value: "python" },
              { key: "ruby", Description: "Ruby", value: "ruby" },
              { key: "ts", Description: "TypeScript", value: "ts" },
            ])),
          };
        },
      };
    },
  };
}

function createRecordingFileSystem(writes, mkdirs) {
  return {
    // mkdirSync is called with { recursive: true }, so every ancestor of a
    // created directory exists too.
    existsSync(filename) {
      return writes.some((entry) => entry.filename === filename)
        || mkdirs.some((directory) => directory === filename || directory.startsWith(`${filename}/`));
    },
    readFileSync(filename) {
      const written = writes.find((entry) => entry.filename === filename);
      if (!written) {
        throw new Error(`Unexpected file ${filename}`);
      }
      return Buffer.from(written.content);
    },
    mkdirSync(filename) {
      mkdirs.push(filename);
    },
    writeFileSync(filename, content) {
      writes.push({ filename, content: String(content) });
    },
    removeSync() {},
  };
}

test("ProjectInitializer offers bundled Kotlin templates when Gauge lists none", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");
  const { errors, quickPicks, registered, vscode } = createFakeVscode();
  const spawns = [];
  const writes = [];
  const mkdirs = [];

  new ProjectInitializer({
    cli: createStockGaugeCli(spawns, createChildProcess()),
    fileSystem: createRecordingFileSystem(writes, mkdirs),
    pathModule: path.posix,
    vscode,
  });

  const command = registered.find((entry) => entry.command === "gauge.createProject");
  await command.handler();

  assert.deepEqual(quickPicks[0].map((template) => template.label), [
    "kotlin_gradle",
    "kotlin_maven",
  ]);
  assert.deepEqual(errors, []);
});

test("ProjectInitializer scaffolds a bundled Kotlin template without running gauge init", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");
  const { commands, errors, registered, vscode } = createFakeVscode();
  const spawns = [];
  const writes = [];
  const mkdirs = [];

  new ProjectInitializer({
    cli: createStockGaugeCli(spawns, createChildProcess()),
    fileSystem: createRecordingFileSystem(writes, mkdirs),
    pathModule: path.posix,
    vscode,
  });

  const command = registered.find((entry) => entry.command === "gauge.createProject");
  await command.handler();

  assert.deepEqual(spawns, []);
  assert.deepEqual(errors, []);
  const written = writes.map((entry) => entry.filename);
  assert.ok(written.includes("/workspace/shop/manifest.json"), written.join(", "));
  assert.ok(written.includes("/workspace/shop/build.gradle.kts"), written.join(", "));
  assert.ok(
    written.some((filename) => filename.endsWith(".kt")),
    written.join(", "),
  );
  assert.ok(
    written.some((filename) => filename.endsWith(".spec")),
    written.join(", "),
  );
  assert.deepEqual(commands, [
    {
      command: "vscode.openFolder",
      args: [{ fsPath: "/workspace/shop" }, true],
    },
  ]);
});

test("ProjectInitializer names the bundled project after the created folder", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");
  const { registered, vscode } = createFakeVscode();
  const writes = [];
  const mkdirs = [];

  new ProjectInitializer({
    cli: createStockGaugeCli([], createChildProcess()),
    fileSystem: createRecordingFileSystem(writes, mkdirs),
    pathModule: path.posix,
    vscode,
  });

  const command = registered.find((entry) => entry.command === "gauge.createProject");
  await command.handler();

  const settings = writes.find((entry) => entry.filename.endsWith("settings.gradle.kts"));
  assert.ok(settings, writes.map((entry) => entry.filename).join(", "));
  assert.match(settings.content, /rootProject\.name = "shop"/);
  assert.doesNotMatch(settings.content, /\{\{/);
});

test("ProjectInitializer keeps a Kotlin project whose Gauge manifest language is java", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");
  const { commands, errors, registered, vscode } = createFakeVscode();
  const removed = [];
  const child = createChildProcess();
  const cli = {
    isGaugeInstalled() {
      return true;
    },
    gaugeCommand() {
      return {
        spawn() {
          setImmediate(() => child.emit("close", 0));
          return child;
        },
        spawnSync() {
          return {
            stdout: Buffer.from(JSON.stringify([
              { key: "kotlin_gradle", Description: "Kotlin Gradle", value: "kotlin_gradle" },
            ])),
          };
        },
      };
    },
  };

  new ProjectInitializer({
    cli,
    fileSystem: {
      existsSync(filename) {
        return filename === "/workspace/shop/src/test/kotlin";
      },
      readFileSync(filename) {
        assert.equal(filename, "/workspace/shop/manifest.json");
        return Buffer.from(JSON.stringify({ Language: "java", Plugins: ["html-report"] }));
      },
      mkdirSync() {},
      writeFileSync() {},
      removeSync(filename) {
        removed.push(filename);
      },
    },
    pathModule: path.posix,
    vscode,
  });

  const command = registered.find((entry) => entry.command === "gauge.createProject");
  await command.handler();

  assert.deepEqual(errors, []);
  assert.deepEqual(removed, []);
  assert.deepEqual(commands, [
    {
      command: "vscode.openFolder",
      args: [{ fsPath: "/workspace/shop" }, true],
    },
  ]);
});

test("ProjectInitializer rejects templates that create non-Kotlin Gauge projects", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");
  const {
    commands,
    errors,
    registered,
    vscode,
  } = createFakeVscode();
  const removes = [];
  const child = createChildProcess();
  const cli = {
    isGaugeInstalled() {
      return true;
    },
    gaugeCommand() {
      return {
        spawn() {
          setImmediate(() => child.emit("close", 0));
          return child;
        },
        spawnSync() {
          return {
            stdout: Buffer.from(JSON.stringify([
              { key: "kotlin", Description: "Kotlin", value: "kotlin" },
            ])),
          };
        },
      };
    },
  };

  new ProjectInitializer({
    cli,
    fileSystem: {
      existsSync() {
        return false;
      },
      readFileSync(filename) {
        assert.equal(filename, "/workspace/shop/manifest.json");
        return Buffer.from(JSON.stringify({ Language: "java" }));
      },
      mkdirSync() {},
      removeSync(filename) {
        removes.push(filename);
      },
    },
    pathModule: path.posix,
    vscode,
  });

  const command = registered.find((entry) => entry.command === "gauge.createProject");
  await assert.rejects(
    () => command.handler(),
    /Selected template did not create a Kotlin Gauge project\./,
  );

  assert.deepEqual(removes, ["/workspace/shop"]);
  assert.deepEqual(errors, ["Selected template did not create a Kotlin Gauge project."]);
  assert.deepEqual(commands, []);
});

test("ProjectInitializer reports template list parsing failures", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");
  const {
    errorActions,
    errors,
    inputs,
    openDialogs,
    quickPicks,
    registered,
    vscode,
  } = createFakeVscode();
  const cli = {
    isGaugeInstalled() {
      return true;
    },
    gaugeCommand() {
      return {
        spawnSync(args) {
          assert.deepEqual(args, ["template", "--list", "--machine-readable"]);
          return {
            stdout: Buffer.from("not-json"),
          };
        },
      };
    },
  };

  new ProjectInitializer({
    cli,
    fileSystem: {
      existsSync() {
        return false;
      },
      mkdirSync() {},
      removeSync() {},
    },
    pathModule: path.posix,
    vscode,
  });

  const command = registered.find((entry) => entry.command === "gauge.createProject");
  await command.handler();

  assert.deepEqual(errors, [
    "Failed to get list of templates."
    + " Try running 'gauge template --list --machine-readable' from the command line.",
  ]);
  assert.deepEqual(errorActions, [[]]);
  assert.deepEqual(quickPicks, []);
  assert.deepEqual(openDialogs, []);
  assert.deepEqual(inputs, []);
});

test("ProjectInitializer lifecycle neutralizes pending prompt settlements", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");

  for (const settlement of ["resolve", "reject"]) {
    const fake = createFakeVscode();
    const prompt = deferred();
    const promptEntered = deferred();
    let registrationDisposeCalls = 0;
    fake.vscode.commands.registerCommand = (command, handler) => {
      fake.registered.push({ command, handler });
      return {
        dispose() {
          registrationDisposeCalls += 1;
        },
      };
    };
    fake.vscode.window.showQuickPick = (items) => {
      fake.quickPicks.push(items);
      promptEntered.resolve();
      return prompt.promise;
    };
    fake.vscode.window.showOpenDialog = (options) => {
      fake.openDialogs.push(options);
      return Promise.resolve(undefined);
    };
    const initializer = new ProjectInitializer({
      cli: {
        isGaugeInstalled() {
          return true;
        },
        gaugeCommand() {
          return {
            spawnSync() {
              return {
                stdout: Buffer.from(JSON.stringify([
                  { key: "kotlin", Description: "Kotlin", value: "kotlin" },
                ])),
              };
            },
          };
        },
      },
      pathModule: path.posix,
      vscode: fake.vscode,
    });
    const handler = fake.registered.find(
      (entry) => entry.command === "gauge.createProject",
    ).handler;
    let settled = false;
    const pending = handler().then(
      (value) => {
        settled = true;
        return value;
      },
      (error) => {
        settled = true;
        throw error;
      },
    );

    await promptEntered.promise;
    initializer.dispose();
    initializer.dispose();
    await new Promise((resolve) => setImmediate(resolve));
    const settledBeforePrompt = settled;
    if (settlement === "resolve") {
      prompt.resolve({ label: "kotlin" });
    } else {
      prompt.reject(new Error("disposed picker failed"));
    }
    const outcome = await Promise.allSettled([pending]);

    assert.deepEqual({
      inputCount: fake.inputs.length,
      openDialogCount: fake.openDialogs.length,
      outcome,
      registrationDisposeCalls,
      settledBeforePrompt,
      settlement,
    }, {
      inputCount: 0,
      openDialogCount: 0,
      outcome: [{ status: "fulfilled", value: undefined }],
      registrationDisposeCalls: 1,
      settledBeforePrompt: true,
      settlement,
    });
  }
});

test("ProjectInitializer lifecycle ignores retained and direct calls after disposal", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");
  const fake = createFakeVscode();
  let createCliCalls = 0;
  let directTemplateCalls = 0;
  let registrationDisposeCalls = 0;
  const removes = [];
  fake.vscode.commands.registerCommand = (command, handler) => {
    fake.registered.push({ command, handler });
    return {
      dispose() {
        registrationDisposeCalls += 1;
      },
    };
  };
  const initializer = new ProjectInitializer({
    createCli() {
      createCliCalls += 1;
      return {
        isGaugeInstalled() {
          return false;
        },
      };
    },
    fileSystem: {
      removeSync(filename) {
        removes.push(filename);
      },
    },
    vscode: fake.vscode,
  });
  const handler = fake.registered.find(
    (entry) => entry.command === "gauge.createProject",
  ).handler;

  initializer.dispose();
  initializer.dispose();
  const outcomes = await Promise.allSettled([
    handler(),
    initializer.createProject(),
    initializer.getTemplatesList({
      gaugeCommand() {
        directTemplateCalls += 1;
        return { spawnSync() {} };
      },
    }),
    initializer.handleError(null, "late error", "/workspace/late"),
  ]);

  assert.deepEqual({
    createCliCalls,
    directTemplateCalls,
    errors: fake.errors,
    outcomes,
    registrationDisposeCalls,
    removes,
  }, {
    createCliCalls: 0,
    directTemplateCalls: 0,
    errors: [],
    outcomes: [
      { status: "fulfilled", value: undefined },
      { status: "fulfilled", value: undefined },
      { status: "fulfilled", value: [] },
      { status: "fulfilled", value: undefined },
    ],
    registrationDisposeCalls: 1,
    removes: [],
  });
});

test("ProjectInitializer lifecycle removes an owned directory before deferred spawn", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");
  const fake = createFakeVscode();
  const progressEntered = deferred();
  const progressCompletion = deferred();
  let runProgressTask;
  fake.vscode.window.withProgress = (_options, task) => {
    runProgressTask = () => {
      const result = Promise.resolve(task({ report() {} }));
      result.then(progressCompletion.resolve, progressCompletion.reject);
      return result;
    };
    progressEntered.resolve();
    return progressCompletion.promise;
  };
  const child = createChildProcess();
  const removes = [];
  let spawnCalls = 0;
  const initializer = new ProjectInitializer({
    cli: {
      isGaugeInstalled() {
        return true;
      },
      gaugeCommand() {
        return {
          spawn() {
            spawnCalls += 1;
            return child;
          },
          spawnSync() {
            return {
              stdout: Buffer.from(JSON.stringify([
                { key: "kotlin", Description: "Kotlin", value: "kotlin" },
              ])),
            };
          },
        };
      },
    },
    fileSystem: {
      existsSync() {
        return false;
      },
      mkdirSync() {},
      removeSync(filename) {
        removes.push(filename);
      },
    },
    pathModule: path.posix,
    vscode: fake.vscode,
  });
  const handler = fake.registered.find(
    (entry) => entry.command === "gauge.createProject",
  ).handler;
  let settled = false;
  const pending = handler().then((value) => {
    settled = true;
    return value;
  });

  await progressEntered.promise;
  initializer.dispose();
  await new Promise((resolve) => setImmediate(resolve));
  const activeOperationCountAfterDispose = initializer.activeOperations.size;
  const settledBeforeRunner = settled;
  const runnerPending = runProgressTask();
  if (spawnCalls > 0) {
    child.emit("close", 1);
  }
  const outcomes = await Promise.allSettled([pending, runnerPending]);

  assert.deepEqual({
    errors: fake.errors,
    activeOperationCountAfterDispose,
    outcomes,
    removes,
    settledBeforeRunner,
    spawnCalls,
  }, {
    errors: [],
    activeOperationCountAfterDispose: 0,
    outcomes: [
      { status: "fulfilled", value: undefined },
      { status: "fulfilled", value: undefined },
    ],
    removes: ["/workspace/shop"],
    settledBeforeRunner: true,
    spawnCalls: 0,
  });
});

test("ProjectInitializer lifecycle detaches active init completion without killing it", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");

  for (const terminalEvent of ["success", "error"]) {
    const fake = createFakeVscode();
    const child = createChildProcess();
    const spawned = deferred();
    const removes = [];
    let killCalls = 0;
    let manifestReads = 0;
    child.kill = () => {
      killCalls += 1;
      return true;
    };
    const initializer = new ProjectInitializer({
      cli: {
        isGaugeInstalled() {
          return true;
        },
        gaugeCommand() {
          return {
            spawn() {
              spawned.resolve();
              return child;
            },
            spawnSync() {
              return {
                stdout: Buffer.from(JSON.stringify([
                  { key: "kotlin", Description: "Kotlin", value: "kotlin" },
                ])),
              };
            },
          };
        },
      },
      fileSystem: {
        existsSync() {
          return false;
        },
        mkdirSync() {},
        readFileSync() {
          manifestReads += 1;
          return Buffer.from(JSON.stringify({ Language: "kotlin" }));
        },
        removeSync(filename) {
          removes.push(filename);
        },
      },
      pathModule: path.posix,
      vscode: fake.vscode,
    });
    const handler = fake.registered.find(
      (entry) => entry.command === "gauge.createProject",
    ).handler;
    let settled = false;
    const pending = handler().then(
      (value) => {
        settled = true;
        return value;
      },
      (error) => {
        settled = true;
        throw error;
      },
    );

    await spawned.promise;
    initializer.dispose();
    await new Promise((resolve) => setImmediate(resolve));
    const activeOperationCountAfterDispose = initializer.activeOperations.size;
    const settledBeforeTerminal = settled;
    if (terminalEvent === "success") {
      child.emit("close", 0);
    } else {
      child.emit("error", new Error("disposed init failed"));
      child.emit("close", 0);
    }
    child.emit("close", 1);
    const outcome = await Promise.allSettled([pending]);

    assert.deepEqual({
      commands: fake.commands,
      activeOperationCountAfterDispose,
      errors: fake.errors,
      killCalls,
      listeners: {
        close: child.listenerCount("close"),
        error: child.listenerCount("error"),
        stdout: child.stdout.listenerCount("data"),
      },
      manifestReads,
      outcome,
      removes,
      settledBeforeTerminal,
      terminalEvent,
    }, {
      commands: [],
      activeOperationCountAfterDispose: 0,
      errors: [],
      killCalls: 0,
      listeners: { close: 0, error: 0, stdout: 0 },
      manifestReads: 0,
      outcome: [{ status: "fulfilled", value: undefined }],
      removes: terminalEvent === "error" ? ["/workspace/shop"] : [],
      settledBeforeTerminal: true,
      terminalEvent,
    });
  }
});

test("ProjectInitializer lifecycle releases child state before reentrant folder opening", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");
  const fake = createFakeVscode();
  const child = createChildProcess();
  const listenerSnapshots = [];
  let initializer;
  let registrationDisposeCalls = 0;
  fake.vscode.commands.registerCommand = (command, handler) => {
    fake.registered.push({ command, handler });
    return {
      dispose() {
        registrationDisposeCalls += 1;
      },
    };
  };
  fake.vscode.commands.executeCommand = (command, ...args) => {
    fake.commands.push({ command, args });
    listenerSnapshots.push({
      close: child.listenerCount("close"),
      error: child.listenerCount("error"),
      stdout: child.stdout.listenerCount("data"),
    });
    initializer.dispose();
    return Promise.resolve(undefined);
  };
  initializer = new ProjectInitializer({
    cli: {
      isGaugeInstalled() {
        return true;
      },
      gaugeCommand() {
        return {
          spawn() {
            setImmediate(() => child.emit("close", 0));
            return child;
          },
          spawnSync() {
            return {
              stdout: Buffer.from(JSON.stringify([
                { key: "kotlin", Description: "Kotlin", value: "kotlin" },
              ])),
            };
          },
        };
      },
    },
    fileSystem: {
      existsSync() {
        return false;
      },
      mkdirSync() {},
      readFileSync() {
        return Buffer.from(JSON.stringify({ Language: "kotlin" }));
      },
      removeSync() {},
    },
    pathModule: path.posix,
    vscode: fake.vscode,
  });
  const handler = fake.registered.find(
    (entry) => entry.command === "gauge.createProject",
  ).handler;

  await handler();
  initializer.dispose();
  child.emit("close", 0);

  assert.deepEqual({
    commands: fake.commands,
    listenerSnapshots,
    registrationDisposeCalls,
  }, {
    commands: [{
      command: "vscode.openFolder",
      args: [{ fsPath: "/workspace/shop" }, true],
    }],
    listenerSnapshots: [{ close: 0, error: 0, stdout: 0 }],
    registrationDisposeCalls: 1,
  });
});

test("ProjectInitializer lifecycle neutralizes every pending selection boundary", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");

  for (const boundaryName of ["folder", "input", "template-error", "existing-error"]) {
    for (const settlement of ["resolve", "reject"]) {
      const fake = createFakeVscode();
      const boundary = deferred();
      const boundaryEntered = deferred();
      let existsCalls = 0;
      let mkdirCalls = 0;
      const showBoundaryError = boundaryName === "template-error"
        || boundaryName === "existing-error";
      fake.vscode.window.showErrorMessage = (message, ...actions) => {
        fake.errors.push(message);
        fake.errorActions.push(actions);
        if (showBoundaryError) {
          boundaryEntered.resolve();
          return boundary.promise;
        }
        return Promise.resolve(undefined);
      };
      fake.vscode.window.showOpenDialog = (options) => {
        fake.openDialogs.push(options);
        if (boundaryName === "folder") {
          boundaryEntered.resolve();
          return boundary.promise;
        }
        return Promise.resolve([{ fsPath: "/workspace" }]);
      };
      fake.vscode.window.showInputBox = (options) => {
        fake.inputs.push(options);
        if (boundaryName === "input") {
          boundaryEntered.resolve();
          return boundary.promise;
        }
        return Promise.resolve(boundaryName === "folder" ? undefined : "shop");
      };
      const initializer = new ProjectInitializer({
        cli: {
          isGaugeInstalled() {
            return true;
          },
          gaugeCommand() {
            return {
              spawnSync() {
                return {
                  stdout: boundaryName === "template-error"
                    ? Buffer.from("not-json")
                    : Buffer.from(JSON.stringify([
                      { key: "kotlin", Description: "Kotlin", value: "kotlin" },
                    ])),
                };
              },
            };
          },
        },
        fileSystem: {
          existsSync(filename) {
            existsCalls += 1;
            if (boundaryName === "existing-error") {
              return filename === "/workspace/shop";
            }
            return boundaryName === "input";
          },
          mkdirSync() {
            mkdirCalls += 1;
          },
          removeSync() {},
        },
        pathModule: path.posix,
        vscode: fake.vscode,
      });
      const handler = fake.registered.find(
        (entry) => entry.command === "gauge.createProject",
      ).handler;
      let settled = false;
      const pending = handler().then(
        (value) => {
          settled = true;
          return value;
        },
        (error) => {
          settled = true;
          throw error;
        },
      );

      await boundaryEntered.promise;
      initializer.dispose();
      await new Promise((resolve) => setImmediate(resolve));
      const settledBeforeBoundary = settled;
      if (settlement === "resolve") {
        const value = boundaryName === "folder"
          ? [{ fsPath: "/workspace" }]
          : boundaryName === "input" ? "shop" : undefined;
        boundary.resolve(value);
      } else {
        boundary.reject(new Error(`disposed ${boundaryName} failed`));
      }
      const outcome = await Promise.allSettled([pending]);

      assert.deepEqual({
        activeOperations: initializer.activeOperations.size,
        boundaryName,
        existsCalls,
        mkdirCalls,
        outcome,
        settledBeforeBoundary,
        settlement,
      }, {
        activeOperations: 0,
        boundaryName,
        existsCalls: boundaryName === "existing-error" ? 2 : 0,
        mkdirCalls: 0,
        outcome: [{ status: "fulfilled", value: undefined }],
        settledBeforeBoundary: true,
        settlement,
      });
    }
  }
});

test("ProjectInitializer lifecycle owns a child returned after synchronous disposal", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");
  const fake = createFakeVscode();
  const child = createChildProcess();
  const removes = [];
  let initializer;
  let killCalls = 0;
  child.kill = () => {
    killCalls += 1;
    return true;
  };
  initializer = new ProjectInitializer({
    cli: {
      isGaugeInstalled() {
        return true;
      },
      gaugeCommand() {
        return {
          spawn() {
            initializer.dispose();
            return child;
          },
          spawnSync() {
            return {
              stdout: Buffer.from(JSON.stringify([
                { key: "kotlin", Description: "Kotlin", value: "kotlin" },
              ])),
            };
          },
        };
      },
    },
    fileSystem: {
      existsSync() {
        return false;
      },
      mkdirSync() {},
      removeSync(filename) {
        removes.push(filename);
      },
    },
    pathModule: path.posix,
    vscode: fake.vscode,
  });
  const handler = fake.registered.find(
    (entry) => entry.command === "gauge.createProject",
  ).handler;

  const pending = handler();
  await new Promise((resolve) => setImmediate(resolve));
  const outcomeBeforeTerminal = await Promise.allSettled([pending]);
  child.emit("error", new Error("late synchronous-spawn failure"));
  child.emit("close", 1);

  assert.deepEqual({
    activeOperations: initializer.activeOperations.size,
    errors: fake.errors,
    killCalls,
    listeners: {
      close: child.listenerCount("close"),
      error: child.listenerCount("error"),
      stdout: child.stdout.listenerCount("data"),
    },
    outcomeBeforeTerminal,
    removes,
  }, {
    activeOperations: 0,
    errors: [],
    killCalls: 0,
    listeners: { close: 0, error: 0, stdout: 0 },
    outcomeBeforeTerminal: [{ status: "fulfilled", value: undefined }],
    removes: ["/workspace/shop"],
  });
});

test("ProjectInitializer lifecycle stops after synchronous filesystem disposal", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");

  for (const boundaryName of ["directory", "manifest"]) {
    const fake = createFakeVscode();
    const errors = [];
    let initializer;
    let mkdirCalls = 0;
    let registrationDisposeCalls = 0;
    fake.vscode.commands.registerCommand = (command, handler) => {
      fake.registered.push({ command, handler });
      return {
        dispose() {
          registrationDisposeCalls += 1;
        },
      };
    };
    fake.vscode.window.showErrorMessage = (message) => {
      errors.push(message);
      return Promise.resolve(undefined);
    };
    initializer = new ProjectInitializer({
      cli: {
        isGaugeInstalled() {
          return true;
        },
        gaugeCommand() {
          return {
            spawnSync() {
              return {
                stdout: Buffer.from(JSON.stringify([
                  { key: "kotlin", Description: "Kotlin", value: "kotlin" },
                ])),
              };
            },
          };
        },
      },
      fileSystem: {
        existsSync(filename) {
          if (boundaryName === "directory" || filename.endsWith("manifest.json")) {
            initializer.dispose();
            return false;
          }
          return true;
        },
        mkdirSync() {
          mkdirCalls += 1;
        },
        removeSync() {},
      },
      pathModule: path.posix,
      vscode: fake.vscode,
    });
    const handler = fake.registered.find(
      (entry) => entry.command === "gauge.createProject",
    ).handler;

    const result = await handler();

    assert.deepEqual({
      activeOperations: initializer.activeOperations.size,
      boundaryName,
      errors,
      mkdirCalls,
      registrationDisposeCalls,
      result,
    }, {
      activeOperations: 0,
      boundaryName,
      errors: [],
      mkdirCalls: 0,
      registrationDisposeCalls: 1,
      result: undefined,
    });
  }
});

test("ProjectInitializer preserves live synchronous spawn failures", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");
  const fake = createFakeVscode();
  const spawnError = new Error("live synchronous spawn failed");
  const removes = [];
  const initializer = new ProjectInitializer({
    cli: {
      isGaugeInstalled() {
        return true;
      },
      gaugeCommand() {
        return {
          spawn() {
            throw spawnError;
          },
          spawnSync() {
            return {
              stdout: Buffer.from(JSON.stringify([
                { key: "kotlin", Description: "Kotlin", value: "kotlin" },
              ])),
            };
          },
        };
      },
    },
    fileSystem: {
      existsSync() {
        return false;
      },
      mkdirSync() {},
      removeSync(filename) {
        removes.push(filename);
      },
    },
    pathModule: path.posix,
    vscode: fake.vscode,
  });
  const handler = fake.registered.find(
    (entry) => entry.command === "gauge.createProject",
  ).handler;

  const outcome = await Promise.allSettled([handler()]);

  assert.equal(outcome[0].status, "rejected");
  assert.equal(outcome[0].reason, spawnError);
  assert.deepEqual(removes, []);
  initializer.dispose();
});

// The bundled templates are what a new user's project starts from, so their
// defaults are the extension's defaults.
// A partly written scaffold is worse than none: the leftover manifest.json makes
// the same command answer "Given location is already a Gauge Project" on the next
// try, so the user cannot retry with the same name. The directory is only removed
// when this operation created it (operation.directoryOwned).
test("ProjectInitializer removes a directory it created when the scaffold fails", async () => {
  const { ProjectInitializer } = require("../src/init/projectInit");
  const { registered, vscode } = createFakeVscode();
  const removed = [];
  let writes = 0;

  new ProjectInitializer({
    cli: {
      isGaugeInstalled: () => true,
      gaugeCommand: () => ({
        spawnSync: () => ({ stdout: Buffer.from("[]") }),
      }),
    },
    env: { PATH: "/bin" },
    fileSystem: {
      existsSync: () => false,
      mkdirSync() {},
      writeFileSync() {
        writes += 1;
        if (writes > 1) {
          throw new Error("ENOSPC: no space left on device");
        }
      },
      rmSync(dirname) {
        removed.push(dirname);
      },
    },
    pathModule: path.posix,
    vscode,
  });

  const command = registered.find((entry) => entry.command === "gauge.createProject");
  // The command surfaces the failure; what matters here is that it does not leave
  // the half-written project behind.
  await command.handler().catch(() => undefined);

  assert.deepEqual(removed, ["/workspace/shop"]);
});

test("bundled templates keep Gauge's own environment defaults", () => {
  const {
    listBundledKotlinTemplates,
    writeBundledKotlinTemplate,
  } = require("../src/init/bundledKotlinTemplates");

  for (const template of listBundledKotlinTemplates()) {
    const written = new Map();
    writeBundledKotlinTemplate({
      fileSystem: { mkdirSync() {}, writeFileSync(file, content) { written.set(file, content); } },
      pathModule: path.posix,
      projectRoot: "/p",
      template,
    });

    const properties = written.get("/p/env/default/default.properties");
    // references/gauge/env/env.go addEnvVar(ScreenshotOnFailure, "true"): a
    // template that turns it off silently loses failure screenshots.
    assert.match(properties, /^screenshot_on_failure = true$/m, template.label);

    const gitignore = written.get("/p/.gitignore");
    // The extension writes .classpath and .project into non-Maven JVM projects
    // (src/config/gaugeProjectConfig.js), so a fresh project should not offer to
    // commit them.
    assert.match(gitignore, /^\.classpath$/m, template.label);
    assert.match(gitignore, /^\.project$/m, template.label);
  }
});

test("the bundled Gradle template says what it needs to run", () => {
  const {
    listBundledKotlinTemplates,
    writeBundledKotlinTemplate,
  } = require("../src/init/bundledKotlinTemplates");
  const gradle = listBundledKotlinTemplates().find((entry) => entry.label === "kotlin_gradle");
  const written = new Map();

  writeBundledKotlinTemplate({
    fileSystem: { mkdirSync() {}, writeFileSync(file, content) { written.set(file, content); } },
    pathModule: path.posix,
    projectRoot: "/p",
    template: gradle,
  });

  // No gradle-wrapper.jar can be embedded in the bundle, so the project needs a
  // Gradle on PATH until the user runs `gradle wrapper`. Say so rather than
  // letting the first run fail with a bare ENOENT.
  const readme = written.get("/p/README.md");
  assert.ok(readme, [...written.keys()].join(", "));
  assert.match(readme, /gradle wrapper/);
});
