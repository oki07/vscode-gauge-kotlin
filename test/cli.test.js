const assert = require("node:assert/strict");
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
