const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const test = require("node:test");

const commandFixturesPath = path.resolve(__dirname, "fixtures/commands");

function createCli() {
  const { CLI, Command } = require("../src/cli");
  return new CLI(new Command("gauge"), {
    version: "1.2.3",
    commitHash: "3db28e6",
    plugins: [
      { name: "csharp", version: "1.2.0" },
      { name: "kotlin", version: "0.9.0" },
      { name: "java", version: "1.0.0" },
    ],
  }, new Command("mvn"), new Command("gradle"));
}

function withCommandFixturesPath(callback) {
  const originalPath = process.env.PATH;
  process.env.PATH = commandFixturesPath;
  try {
    return callback();
  } finally {
    process.env.PATH = originalPath;
  }
}

function portableCommandCandidates(CLI, command) {
  return CLI.getCommandCandidates(command).filter((entry) => entry.cmdSuffix !== ".exe");
}

test("CLI reports installed plugins and plugin versions", () => {
  const cli = createCli();

  assert.equal(cli.isPluginInstalled("kotlin"), true);
  assert.equal(cli.isPluginInstalled("KOTLIN"), true);
  assert.equal(cli.isPluginInstalled("ruby"), false);
  assert.equal(cli.getGaugePluginVersion("java"), "1.0.0");
});

test("CLI formats Gauge version information", () => {
  const cli = createCli();

  assert.equal(cli.gaugeVersionString(), [
    "Gauge version: 1.2.3",
    "Commit Hash: 3db28e6",
    "",
    "Plugins",
    "-------",
    "csharp (1.2.0)",
    "kotlin (0.9.0)",
    "java (1.0.0)",
  ].join("\n"));
});

test("CLI omits the commit hash line when Gauge does not report one", () => {
  const { CLI, Command } = require("../src/cli");
  const cli = new CLI(new Command("gauge"), {
    version: "1.2.3",
    plugins: [
      { name: "kotlin", version: "0.9.0" },
      { name: "java", version: "1.0.0" },
    ],
  }, new Command("mvn"), new Command("gradle"));

  assert.equal(cli.gaugeVersionString(), [
    "Gauge version: 1.2.3",
    "",
    "",
    "Plugins",
    "-------",
    "kotlin (0.9.0)",
    "java (1.0.0)",
  ].join("\n"));
});

test("CLI compares Gauge versions", () => {
  const cli = createCli();

  assert.equal(cli.isGaugeVersionGreaterOrEqual("1.2.3"), true);
  assert.equal(cli.isGaugeVersionGreaterOrEqual("1.2.0"), true);
  assert.equal(cli.isGaugeVersionGreaterOrEqual("2.0.0"), false);
  assert.equal(cli.isGaugeVersionGreaterOrEqual("1.3.0"), false);
});

test("CLI reports whether Gauge is installed", () => {
  const { CLI, Command } = require("../src/cli");

  assert.equal(new CLI(new Command("gauge"), {}, undefined, undefined).isGaugeInstalled(), true);
  assert.equal(new CLI(null, {}, undefined, undefined).isGaugeInstalled(), false);
});

test("CLI refreshes the version manifest after a successful plugin install", async () => {
  const { CLI } = require("../src/cli");
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const calls = [];
  const expectedEnv = {
    PATH: "/usr/bin",
    GAUGE_HOME: "/tools/gauge-home",
  };
  const command = {
    spawn(args, options) {
      calls.push({ args, options, type: "install" });
      return child;
    },
    spawnSync(args, options) {
      calls.push({ args, options, type: "version" });
      return {
        status: 0,
        stdout: Buffer.from([
          "[DEPRECATED] Ignore this warning.",
          JSON.stringify({
            version: "1.3.0",
            commitHash: "new-commit",
            plugins: [
              { name: "kotlin", version: "0.10.0" },
              { name: "Spectacle", version: "1.0.2" },
            ],
          }),
        ].join("\n")),
      };
    },
  };
  const cli = new CLI(command, {
    version: "1.2.3",
    commitHash: "old-commit",
    plugins: [{ name: "kotlin", version: "0.9.0" }],
  });
  const vscode = {
    window: {
      createOutputChannel() {
        return { appendLine() {}, clear() {}, show() {} };
      },
    },
    workspace: {
      getConfiguration() {
        return {
          get(key) {
            return key === "home" ? "/tools/gauge-home" : undefined;
          },
        };
      },
    },
  };

  const installation = cli.installGaugeRunner("spectacle", {
    env: { PATH: "/usr/bin" },
    vscode,
  });
  assert.equal(cli.isPluginInstalled("spectacle"), false);
  child.emit("exit", 0);
  child.emit("close", 0);

  assert.equal(await installation, true);
  assert.equal(cli.gaugeVersion, "1.3.0");
  assert.equal(cli.gaugeCommitHash, "new-commit");
  assert.deepEqual(cli.gaugePlugins, [
    { name: "kotlin", version: "0.10.0" },
    { name: "Spectacle", version: "1.0.2" },
  ]);
  assert.equal(cli.isPluginInstalled("spectacle"), true);
  assert.equal(cli.getGaugePluginVersion("SPECTACLE"), "1.0.2");
  assert.deepEqual(calls, [
    {
      args: ["install", "spectacle"],
      options: { env: expectedEnv },
      type: "install",
    },
    {
      args: ["--version", "--machine-readable"],
      options: { env: expectedEnv },
      type: "version",
    },
  ]);
});

test("CLI waits for plugin install close before refreshing and publishing completion", async () => {
  const { CLI } = require("../src/cli");
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const outputLines = [];
  let probeCalls = 0;
  const cli = new CLI({
    spawn() {
      return child;
    },
    spawnSync() {
      probeCalls += 1;
      return {
        status: 0,
        stdout: Buffer.from(JSON.stringify({ version: "1.3.0", plugins: [] })),
      };
    },
  }, {});
  const installation = cli.installGaugeRunner("spectacle", {
    vscode: {
      window: {
        createOutputChannel() {
          return {
            appendLine(line) {
              outputLines.push(line);
            },
            clear() {},
            show() {},
          };
        },
      },
    },
  });
  let settled = false;
  installation.finally(() => {
    settled = true;
  });

  child.stdout.emit("data", Buffer.from("plugin "));
  child.stderr.emit("data", Buffer.from("warning "));
  child.emit("exit", 0);
  await Promise.resolve();

  assert.equal(settled, false);
  assert.equal(probeCalls, 0);
  assert.equal(child.stdout.listenerCount("data"), 1);
  assert.deepEqual(outputLines, ["Installing gauge spectacle plugin ...\n"]);

  child.stdout.emit("data", Buffer.from("installed"));
  child.stderr.emit("data", Buffer.from("tail"));
  assert.deepEqual(outputLines, ["Installing gauge spectacle plugin ...\n"]);
  child.emit("close", 0);

  assert.equal(await installation, true);
  assert.equal(probeCalls, 1);
  assert.ok(outputLines.indexOf("plugin installed") > 0);
  assert.ok(outputLines.indexOf("warning tail") > outputLines.indexOf("plugin installed"));
  assert.ok(outputLines.indexOf("") > outputLines.indexOf("warning tail"));
  assert.equal(child.listenerCount("close"), 0);
  assert.equal(child.stdout.listenerCount("data"), 0);
  assert.equal(child.stderr.listenerCount("data"), 0);
});

test("CLI preserves the version manifest when installation or refresh fails", async () => {
  const { CLI } = require("../src/cli");
  const originalManifest = {
    version: "1.2.3",
    commitHash: "old-commit",
    plugins: [{ name: "kotlin", version: "0.9.0" }],
  };

  for (const scenario of [
    { closeCode: null, installCode: 1, probeOutput: undefined, result: false },
    { installCode: 0, probeOutput: "not json", result: true },
    {
      installCode: 0,
      probeOutput: JSON.stringify({ version: "1.3.0", plugins: null }),
      result: true,
    },
    {
      installCode: 0,
      probeOutput: JSON.stringify({ version: "1.3.0", commitHash: "new-commit" }),
      result: true,
    },
    {
      installCode: 0,
      probeOutput: JSON.stringify({
        version: 130,
        plugins: [{ name: "spectacle", version: "1.0.0" }],
      }),
      result: true,
    },
    {
      installCode: 0,
      probeResult: { status: 1, stdout: Buffer.from("version probe failed") },
      result: true,
    },
    {
      installCode: 0,
      probeResult: {
        error: new Error("version probe did not start"),
        status: 0,
        stdout: Buffer.from(""),
      },
      result: true,
    },
    { installCode: 0, probeError: new Error("version probe failed"), result: true },
  ]) {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    let probeCalls = 0;
    const command = {
      spawn() {
        return child;
      },
      spawnSync() {
        probeCalls += 1;
        if (scenario.probeError) {
          throw scenario.probeError;
        }
        if (scenario.probeResult) {
          return scenario.probeResult;
        }
        return { status: 0, stdout: Buffer.from(scenario.probeOutput) };
      },
    };
    const cli = new CLI(command, originalManifest);
    const installation = cli.installGaugeRunner("spectacle", {
      vscode: {
        window: {
          createOutputChannel() {
            return { appendLine() {}, clear() {}, show() {} };
          },
        },
      },
    });

    child.emit("exit", scenario.installCode);
    child.emit(
      "close",
      Object.hasOwn(scenario, "closeCode") ? scenario.closeCode : scenario.installCode,
    );

    assert.equal(await installation, scenario.result);
    assert.equal(probeCalls, scenario.installCode === 0 ? 1 : 0);
    assert.equal(cli.gaugeVersion, originalManifest.version);
    assert.equal(cli.gaugeCommitHash, originalManifest.commitHash);
    assert.deepEqual(cli.gaugePlugins, originalManifest.plugins);
  }
});

test("CLI settles plugin installation when the Gauge process emits an error", async () => {
  const { CLI } = require("../src/cli");
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const outputLines = [];
  let probeCalls = 0;
  const cli = new CLI({
    spawn() {
      return child;
    },
    spawnSync() {
      probeCalls += 1;
      return {
        status: 0,
        stdout: Buffer.from(JSON.stringify({ version: "1.3.0", plugins: [] })),
      };
    },
  }, {
    version: "1.2.3",
    plugins: [{ name: "kotlin", version: "0.9.0" }],
  });
  const installation = cli.installGaugeRunner("spectacle", {
    vscode: {
      window: {
        createOutputChannel() {
          return {
            appendLine(line) {
              outputLines.push(line);
            },
            clear() {},
            show() {},
          };
        },
      },
    },
  });
  const processError = new Error("gauge install spawn failed");
  let settled = false;
  installation.finally(() => {
    settled = true;
  });

  assert.equal(child.listenerCount("error"), 1);
  assert.doesNotThrow(() => child.emit("error", processError));
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(child.listenerCount("close"), 1);
  assert.equal(child.stdout.listenerCount("data"), 1);
  assert.equal(child.stderr.listenerCount("data"), 1);
  child.stderr.emit("data", Buffer.from("late install error output\n"));
  child.emit("close", 0);

  assert.equal(await installation, false);
  assert.equal(probeCalls, 0);
  assert.ok(outputLines.includes("late install error output"));
  assert.ok(outputLines.includes(processError.message));
  assert.equal(child.listenerCount("error"), 0);
  assert.equal(child.listenerCount("exit"), 0);
  assert.equal(child.listenerCount("close"), 0);
  assert.equal(child.stdout.listenerCount("data"), 0);
  assert.equal(child.stderr.listenerCount("data"), 0);

  child.emit("exit", 0);
  child.emit("close", 0);
  await Promise.resolve();
  assert.equal(probeCalls, 0);
});

test("CLI treats signal-closed plugin installation as failure", async () => {
  const { CLI } = require("../src/cli");
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let probeCalls = 0;
  const outputLines = [];
  const cli = new CLI({
    spawn() {
      return child;
    },
    spawnSync() {
      probeCalls += 1;
      return { status: 0, stdout: Buffer.from("") };
    },
  }, {});
  const installation = cli.installGaugeRunner("spectacle", {
    vscode: {
      window: {
        createOutputChannel() {
          return {
            appendLine(line) {
              outputLines.push(line);
            },
            clear() {},
            show() {},
          };
        },
      },
    },
  });

  child.emit("exit", null, "SIGTERM");
  child.emit("close", null, "SIGTERM");

  assert.equal(await installation, false);
  assert.equal(probeCalls, 0);
  assert.ok(outputLines.includes(
    "\nRefer to https://docs.gauge.org/plugin.html to install manually",
  ));
});

test("CLI preserves synchronous plugin installation spawn errors", async () => {
  const { CLI } = require("../src/cli");
  const spawnError = new Error("gauge install did not start");
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let cli;
  let follower;
  let probeCalls = 0;
  let reentered = false;
  let spawnCalls = 0;
  const vscode = {
    window: {
      createOutputChannel() {
        if (!reentered) {
          reentered = true;
          follower = cli.installGaugeRunner("SPECTACLE", { vscode });
        }
        return { appendLine() {}, clear() {}, show() {} };
      },
    },
  };
  cli = new CLI({
    spawn() {
      spawnCalls += 1;
      if (spawnCalls === 1) {
        throw spawnError;
      }
      return child;
    },
    spawnSync() {
      probeCalls += 1;
      return {
        status: 0,
        stdout: Buffer.from(JSON.stringify({ version: "1.3.0", plugins: [] })),
      };
    },
  }, {});

  const leader = cli.installGaugeRunner("spectacle", { vscode });
  assert.equal(follower, leader);
  await assert.rejects(
    leader,
    (error) => error === spawnError,
  );
  assert.equal(probeCalls, 0);

  const retry = cli.installGaugeRunner("spectacle", { vscode });
  child.emit("exit", 0);
  child.emit("close", 0);

  assert.equal(await retry, true);
  assert.equal(spawnCalls, 2);
  assert.equal(probeCalls, 1);
});

test("CLI shares only an in-flight same-plugin installation", async () => {
  const { CLI } = require("../src/cli");
  const snapshots = [];

  for (const installCode of [0, 1]) {
    const spawned = [];
    const channels = [];
    let cli;
    let reentrantFollower;
    let reentered = false;
    let probeCalls = 0;
    const vscode = {
      window: {
        createOutputChannel() {
          const channel = { appendLine() {}, clear() {}, show() {} };
          channels.push(channel);
          if (!reentered) {
            reentered = true;
            reentrantFollower = cli.installGaugeRunner("KOTLIN", { vscode });
          }
          return channel;
        },
      },
    };
    const command = {
      spawn(args) {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        const record = { args, child, exited: false };
        spawned.push(record);
        return child;
      },
      spawnSync() {
        probeCalls += 1;
        return {
          status: 0,
          stdout: Buffer.from(JSON.stringify({ version: "1.3.0", plugins: [] })),
        };
      },
    };
    cli = new CLI(command, { version: "1.2.3", plugins: [] });

    const leader = cli.installGaugeRunner("kotlin", { vscode });
    const java = cli.installGaugeRunner("java", { vscode });
    for (const record of spawned.filter((entry) => entry.args[1].toLowerCase() === "kotlin")) {
      record.exited = true;
      record.child.emit("exit", installCode);
    }
    const afterExitFollower = cli.installGaugeRunner("KoTlIn", { vscode });
    const beforeRetrySpawnArgs = spawned.map((entry) => entry.args);
    const channelsBeforeRetry = channels.length;

    for (const record of spawned) {
      const code = record.args[1].toLowerCase() === "java" ? 0 : installCode;
      if (!record.exited) {
        record.exited = true;
        record.child.emit("exit", code);
      }
      record.child.emit("close", code);
    }
    const outcomes = await Promise.all([
      leader,
      reentrantFollower,
      afterExitFollower,
      java,
    ]);

    const retry = cli.installGaugeRunner("kotlin", { vscode });
    const retryRecord = spawned.at(-1);
    retryRecord.child.emit("exit", installCode);
    retryRecord.child.emit("close", installCode);
    const retryOutcome = await retry;

    snapshots.push({
      afterExitShared: afterExitFollower === leader,
      beforeRetrySpawnArgs,
      channelsBeforeRetry,
      installCode,
      leaderShared: reentrantFollower === leader,
      outcomes,
      probeCalls,
      retryOutcome,
      totalChannels: channels.length,
      totalSpawnArgs: spawned.map((entry) => entry.args),
    });
  }

  assert.deepEqual(snapshots, [
    {
      afterExitShared: true,
      beforeRetrySpawnArgs: [
        ["install", "kotlin"],
        ["install", "java"],
      ],
      channelsBeforeRetry: 2,
      installCode: 0,
      leaderShared: true,
      outcomes: [true, true, true, true],
      probeCalls: 3,
      retryOutcome: true,
      totalChannels: 3,
      totalSpawnArgs: [
        ["install", "kotlin"],
        ["install", "java"],
        ["install", "kotlin"],
      ],
    },
    {
      afterExitShared: true,
      beforeRetrySpawnArgs: [
        ["install", "kotlin"],
        ["install", "java"],
      ],
      channelsBeforeRetry: 2,
      installCode: 1,
      leaderShared: true,
      outcomes: [false, false, false, true],
      probeCalls: 1,
      retryOutcome: false,
      totalChannels: 3,
      totalSpawnArgs: [
        ["install", "kotlin"],
        ["install", "java"],
        ["install", "kotlin"],
      ],
    },
  ]);
});

test("CLI retains and releases a same-plugin install when output completion throws", async () => {
  const { CLI } = require("../src/cli");
  const finishError = new Error("install output completion failed");
  const spawned = [];
  let cli;
  let finishFollower;
  let throwOnFinish = true;
  const vscode = {
    window: {
      createOutputChannel() {
        return {
          appendLine(line) {
            if (line === "" && throwOnFinish) {
              throwOnFinish = false;
              finishFollower = cli.installGaugeRunner("KOTLIN", { vscode });
              throw finishError;
            }
          },
          clear() {},
          show() {},
        };
      },
    },
  };
  cli = new CLI({
    spawn(args) {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      spawned.push({ args, child });
      return child;
    },
    spawnSync() {
      return {
        status: 0,
        stdout: Buffer.from(JSON.stringify({ version: "1.3.0", plugins: [] })),
      };
    },
  }, {});

  const leader = cli.installGaugeRunner("kotlin", { vscode });
  spawned[0].child.emit("exit", 0);
  assert.doesNotThrow(() => spawned[0].child.emit("close", 0));
  await assert.rejects(leader, (error) => error === finishError);
  for (const record of spawned.slice(1)) {
    record.child.emit("exit", 0);
    record.child.emit("close", 0);
  }
  await Promise.allSettled([finishFollower]);

  assert.equal(finishFollower, leader);
  assert.equal(spawned.length, 1);

  const retry = cli.installGaugeRunner("kotlin", { vscode });
  const retryRecord = spawned.at(-1);
  retryRecord.child.emit("exit", 0);
  retryRecord.child.emit("close", 0);

  assert.equal(await retry, true);
  assert.equal(spawned.length, 2);
  assert.deepEqual(spawned.map((entry) => entry.args), [
    ["install", "kotlin"],
    ["install", "kotlin"],
  ]);
});

test("CLI parses Gauge machine-readable version output with deprecated warnings", () => {
  const { CLI, Command } = require("../src/cli");
  const errors = [];
  const fakeGaugeCommand = {
    spawnSync(args) {
      assert.deepEqual(args, ["--version", "--machine-readable"]);
      return {
        stdout: Buffer.from([
          "[DEPRECATED] This warning should not break JSON parsing.",
          JSON.stringify({
            version: "1.2.3",
            commitHash: "3db28e6",
            plugins: [{ name: "kotlin", version: "0.9.0" }],
          }),
        ].join("\n")),
      };
    },
  };

  class TestCLI extends CLI {
    static getCommand(command) {
      if (command === "gauge") {
        return fakeGaugeCommand;
      }
      if (command === "mvn") {
        return new Command("mvn");
      }
      return undefined;
    }
  }

  const cli = TestCLI.instance({
    vscode: {
      window: {
        showErrorMessage(message) {
          errors.push(message);
        },
      },
    },
  });

  assert.equal(cli.gaugeVersionString(), [
    "Gauge version: 1.2.3",
    "Commit Hash: 3db28e6",
    "",
    "Plugins",
    "-------",
    "kotlin (0.9.0)",
  ].join("\n"));
  assert.deepEqual(errors, []);
});

test("CLI uses the configured Gauge executable path before PATH lookup", () => {
  const { CLI, Command } = require("../src/cli");
  const lookupCalls = [];
  const configuredGaugeCommand = {
    command: "/tools/gauge/bin/gauge",
    spawnSync(args) {
      assert.deepEqual(args, ["--version", "--machine-readable"]);
      return {
        stdout: Buffer.from(JSON.stringify({
          version: "1.2.3",
          plugins: [{ name: "kotlin", version: "0.9.0" }],
        })),
      };
    },
  };

  class TestCLI extends CLI {
    static getConfiguredCommand(command, testArgs) {
      lookupCalls.push({ command, testArgs });
      return configuredGaugeCommand;
    }

    static getCommand(command) {
      lookupCalls.push({ command });
      if (command === "mvn") {
        return new Command("mvn");
      }
      return undefined;
    }
  }

  const cli = TestCLI.instance({
    vscode: {
      workspace: {
        getConfiguration(section) {
          assert.equal(section, "gauge");
          return {
            get(key) {
              return key === "executablePath" ? "/tools/gauge/bin/gauge" : "";
            },
          };
        },
      },
      window: {
        showErrorMessage() {},
      },
    },
  });

  assert.equal(cli.isGaugeInstalled(), true);
  assert.equal(cli.gaugeCommand(), configuredGaugeCommand);
  assert.deepEqual(lookupCalls, [
    {
      command: "/tools/gauge/bin/gauge",
      testArgs: ["--version"],
    },
    { command: "mvn" },
  ]);
});

test("CLI validates configured executable with configured GAUGE_HOME", () => {
  const { CLI, Command } = require("../src/cli");
  const lookupCalls = [];
  const configuredGaugeCommand = {
    spawnSync(args, options) {
      assert.deepEqual(args, ["--version", "--machine-readable"]);
      assert.deepEqual(options, {
        env: {
          PATH: "/usr/bin",
          GAUGE_HOME: "/tools/gauge-home",
        },
      });
      return {
        stdout: Buffer.from(JSON.stringify({
          version: "1.2.3",
          plugins: [{ name: "kotlin", version: "0.9.0" }],
        })),
      };
    },
  };

  class TestCLI extends CLI {
    static getConfiguredCommand(command, testArgs, options) {
      lookupCalls.push({ command, options, testArgs });
      return configuredGaugeCommand;
    }

    static getCommand(command) {
      if (command === "mvn") {
        return new Command("mvn");
      }
      return undefined;
    }
  }

  const cli = TestCLI.instance({
    env: { PATH: "/usr/bin" },
    vscode: {
      workspace: {
        getConfiguration(section) {
          assert.equal(section, "gauge");
          return {
            get(key) {
              if (key === "executablePath") {
                return "/tools/gauge/bin/gauge";
              }
              return key === "home" ? "/tools/gauge-home" : "";
            },
          };
        },
      },
      window: {
        showErrorMessage() {},
      },
    },
  });

  assert.equal(cli.isGaugeInstalled(), true);
  assert.deepEqual(lookupCalls, [
    {
      command: "/tools/gauge/bin/gauge",
      options: {
        env: {
          PATH: "/usr/bin",
          GAUGE_HOME: "/tools/gauge-home",
        },
      },
      testArgs: ["--version"],
    },
  ]);
});

test("CLI passes configured GAUGE_HOME to the Gauge version probe", () => {
  const { CLI, Command } = require("../src/cli");
  const versionProbeCalls = [];
  const configuredGaugeCommand = {
    spawnSync(args, options) {
      versionProbeCalls.push({ args, options });
      return {
        stdout: Buffer.from(JSON.stringify({
          version: "1.2.3",
          plugins: [{ name: "kotlin", version: "0.9.0" }],
        })),
      };
    },
  };

  class TestCLI extends CLI {
    static getCommand(command) {
      if (command === "gauge") {
        return configuredGaugeCommand;
      }
      if (command === "mvn") {
        return new Command("mvn");
      }
      return undefined;
    }
  }

  const cli = TestCLI.instance({
    env: { PATH: "/usr/bin" },
    vscode: {
      workspace: {
        getConfiguration(section) {
          assert.equal(section, "gauge");
          return {
            get(key) {
              return key === "home" ? "/tools/gauge-home" : "";
            },
          };
        },
      },
      window: {
        showErrorMessage() {},
      },
    },
  });

  assert.equal(cli.isGaugeInstalled(), true);
  assert.deepEqual(versionProbeCalls, [
    {
      args: ["--version", "--machine-readable"],
      options: {
        env: {
          PATH: "/usr/bin",
          GAUGE_HOME: "/tools/gauge-home",
        },
      },
    },
  ]);
});

test("CLI creates platform command candidates", () => {
  const { CLI } = require("../src/cli");
  const candidates = CLI.getCommandCandidates("gauge");

  if (process.platform === "win32") {
    assert.deepEqual(candidates.map((candidate) => candidate.command), [
      "gauge.exe",
      "gauge.bat",
      "gauge.cmd",
    ]);
  } else {
    assert.deepEqual(candidates.map((candidate) => candidate.command), ["gauge"]);
  }
});

test("CLI checks command spawnability", () => {
  const { CLI } = require("../src/cli");

  assert.equal(CLI.isSpawnable({
    spawnSync(args) {
      assert.deepEqual(args, ["--version"]);
      return { status: 0 };
    },
  }, ["--version"]), true);
  assert.equal(CLI.isSpawnable({
    spawnSync() {
      return { status: 1 };
    },
  }), false);
  assert.equal(CLI.isSpawnable({
    spawnSync() {
      return { status: 0, error: new Error("nope") };
    },
  }), false);
});

test("CLI validates executable fixtures from PATH", () => {
  const { CLI } = require("../src/cli");

  withCommandFixturesPath(() => {
    const invalidCandidates = portableCommandCandidates(CLI, "test_command")
      .filter((candidate) => !CLI.isSpawnable(candidate))
      .map((candidate) => candidate.command);
    const validMissingCandidates = portableCommandCandidates(CLI, "test_command_not_found")
      .filter((candidate) => CLI.isSpawnable(candidate))
      .map((candidate) => candidate.command);

    assert.deepEqual(invalidCandidates, []);
    assert.deepEqual(validMissingCandidates, []);

    for (const candidate of portableCommandCandidates(CLI, "test_command_needs_version_arg")) {
      assert.equal(CLI.isSpawnable(candidate), false, `${candidate.command} should require --version`);
      assert.equal(CLI.isSpawnable(candidate, ["--version"]), true);
    }
  });
});

test("Command spawns executable fixtures with arguments", () => {
  const { CLI } = require("../src/cli");

  withCommandFixturesPath(() => {
    for (const candidate of portableCommandCandidates(CLI, "test_command")) {
      const result = candidate.spawnSync(["Hello World"]);

      assert.equal(result.status, 0, `${candidate.command} failed to spawn`);
      assert.equal(result.error, undefined);
      assert.equal(result.stdout.toString().trim(), "Success: \"Hello World\"");
    }
  });
});

test("Command quotes shell-mode arguments with spaces", () => {
  const { Command } = require("../src/cli");
  const command = new Command("gauge", ".cmd", true);

  assert.equal(command.command, "gauge.cmd");
  assert.deepEqual(command.argsForSpawnType(["run", "Hello World"]), ["run", "\"Hello World\""]);
});
