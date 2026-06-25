const assert = require("node:assert/strict");
const test = require("node:test");

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

test("CLI reports installed plugins and plugin versions", () => {
  const cli = createCli();

  assert.equal(cli.isPluginInstalled("kotlin"), true);
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

test("Command quotes shell-mode arguments with spaces", () => {
  const { Command } = require("../src/cli");
  const command = new Command("gauge", ".cmd", true);

  assert.equal(command.command, "gauge.cmd");
  assert.deepEqual(command.argsForSpawnType(["run", "Hello World"]), ["run", "\"Hello World\""]);
});
