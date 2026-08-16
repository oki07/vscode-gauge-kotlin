const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const test = require("node:test");

class FakeOutputChannel {
  constructor() {
    this.lines = [];
    this.showCalls = [];
  }

  appendLine(value) {
    this.lines.push(value);
  }

  clear() {
    this.lines = [];
  }

  show(preserveFocus) {
    this.showCalls.push(preserveFocus);
  }
}

function createChildProcess() {
  const child = new EventEmitter();
  child.pid = 2468;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.killCalls = [];
  child.kill = function kill(signal) {
    child.killed = true;
    child.killCalls.push(signal);
  };
  return child;
}

test("process runner spawns Gauge and routes stdout through output and line processors", async () => {
  const { createGaugeProcessRunner } = require("../../src/execution/processRunner");
  const child = createChildProcess();
  const outputChannel = new FakeOutputChannel();
  const spawnCalls = [];
  const processedLines = [];
  const processStarts = [];

  const runner = createGaugeProcessRunner({
    pathModule: path.posix,
    outputChannel,
    processStarted() {
      processStarts.push("started");
    },
    processOutputLine(lineText) {
      processedLines.push(lineText);
    },
    spawn(command, args, options) {
      spawnCalls.push({ command, args, options });
      return child;
    },
  });

  const run = runner({
    command: "gauge",
    args: ["run", "specs/example.spec"],
    cwd: "/workspace",
  });

  assert.deepEqual(processStarts, ["started"]);

  child.stdout.emit(
    "data",
    "      Specification: specs/example.spec:19\nSuccessfully generated html-report to => /workspace/reports/index.html\n",
  );
  child.stderr.emit("data", "warning\n");
  child.emit("exit", 0);

  assert.equal(await run, true);
  assert.deepEqual(spawnCalls, [
    {
      command: "gauge",
      args: ["run", "specs/example.spec"],
      options: {
        cwd: "/workspace",
        detached: process.platform !== "win32",
        env: process.env,
      },
    },
  ]);
  assert.deepEqual(processedLines, [
    "      Specification: specs/example.spec:19\n",
    "Successfully generated html-report to => /workspace/reports/index.html\n",
  ]);
  assert.equal(outputChannel.lines.at(-2), "warning");
  assert.equal(outputChannel.lines.at(-1), "Success: Tests passed.");
  assert.ok(outputChannel.lines.includes("      Specification: /workspace/specs/example.spec:19"));
});

test("process runner reveals the execution output channel for runs without a test UI", async () => {
  const { createGaugeProcessRunner } = require("../../src/execution/processRunner");
  const child = createChildProcess();
  const outputChannel = new FakeOutputChannel();

  const runner = createGaugeProcessRunner({
    pathModule: path.posix,
    outputChannel,
    spawn() {
      return child;
    },
  });

  const run = runner({
    command: "gauge",
    args: ["run", "specs/example.spec"],
    cwd: "/workspace",
  });
  child.emit("exit", 0);
  await run;

  assert.deepEqual(outputChannel.showCalls, [true]);
});

test("process runner keeps the output channel hidden when the test UI shows the run", async () => {
  const { createGaugeProcessRunner } = require("../../src/execution/processRunner");
  const child = createChildProcess();
  const outputChannel = new FakeOutputChannel();

  const runner = createGaugeProcessRunner({
    pathModule: path.posix,
    outputChannel,
    spawn() {
      return child;
    },
  });

  const run = runner({
    command: "gauge",
    args: ["run", "specs/example.spec"],
    cwd: "/workspace",
    forwardOutput: true,
  });
  child.emit("exit", 0);
  await run;

  assert.deepEqual(outputChannel.showCalls, []);
});

test("process runner hides machine-readable JSON events from output", async () => {
  const { createGaugeProcessRunner } = require("../../src/execution/processRunner");
  const child = createChildProcess();
  const outputChannel = new FakeOutputChannel();
  const processedLines = [];

  const runner = createGaugeProcessRunner({
    pathModule: path.posix,
    outputChannel,
    processOutputLine(lineText) {
      processedLines.push(lineText);
    },
    spawn() {
      return child;
    },
  });

  const run = runner({
    command: "gauge",
    args: ["run", "--machine-readable", "specs/example.spec"],
    cwd: "/workspace",
  });

  const specStart = "{\"type\":\"specStart\",\"id\":\"spec-1\",\"name\":\"Example\"}";
  const output = "{\"type\":\"out\",\"message\":\"visible output\"}";
  child.stdout.emit(
    "data",
    `${specStart}\n${output}\nSuccessfully generated html-report to => /workspace/reports/index.html\n`,
  );
  child.emit("exit", 0);

  assert.equal(await run, true);
  assert.deepEqual(processedLines, [
    `${specStart}\n`,
    `${output}\n`,
    "Successfully generated html-report to => /workspace/reports/index.html\n",
  ]);
  assert.equal(outputChannel.lines.includes(specStart), false);
  assert.equal(outputChannel.lines.includes(output), false);
  assert.ok(outputChannel.lines.includes("visible output"));
  assert.ok(
    outputChannel.lines.includes("Successfully generated html-report to => /workspace/reports/index.html"),
  );
});

test("process runner forwards Gauge output chunks unchanged for Test UI runs", async () => {
  const { createGaugeProcessRunner } = require("../../src/execution/processRunner");
  const child = createChildProcess();
  const outputChannel = new FakeOutputChannel();
  const chunks = [];
  const spawnCalls = [];
  const runner = createGaugeProcessRunner({
    env: { PATH: "/bin" },
    outputChannel,
    processOutputChunk(chunk) {
      chunks.push(chunk);
    },
    spawn(command, args, options) {
      spawnCalls.push({ command, args, options });
      return child;
    },
  });

  const run = runner({
    command: "gauge",
    args: ["run", "specs/example.spec"],
    cwd: "/workspace",
    forwardOutput: true,
    saveExecutionResult: true,
  });

  child.stdout.emit("data", "\x1b[0;36m# Checkout\n\x1b[0mprogress\r");
  child.stderr.emit("data", "runner warning\n");
  child.emit("exit", 0);

  assert.equal(await run, true);
  assert.deepEqual(chunks, [
    "\x1b[0;36m# Checkout\n\x1b[0mprogress\r",
    "runner warning\n",
  ]);
  assert.deepEqual(spawnCalls[0].options.env, {
    PATH: "/bin",
    save_execution_result: "true",
  });
});

test("process runner preserves UTF-8 split across Gauge output chunks", async () => {
  const { createGaugeProcessRunner } = require("../../src/execution/processRunner");
  const child = createChildProcess();
  const outputChannel = new FakeOutputChannel();
  const chunks = [];
  const runner = createGaugeProcessRunner({
    outputChannel,
    processOutputChunk(chunk) {
      chunks.push(chunk);
    },
    spawn() {
      return child;
    },
  });

  const run = runner({
    command: "gauge",
    args: ["run", "specs/example.spec"],
    cwd: "/workspace",
    forwardOutput: true,
  });
  const output = Buffer.from("# \u4ed5\u69d8\n", "utf8");
  child.stdout.emit("data", output.subarray(0, 4));
  child.stdout.emit("data", output.subarray(4));
  child.emit("exit", 0);

  assert.equal(await run, true);
  assert.equal(chunks.join(""), "# \u4ed5\u69d8\n");
});

test("process runner preserves Gauge output delivered after process exit", async () => {
  const { createGaugeProcessRunner } = require("../../src/execution/processRunner");
  const child = createChildProcess();
  child.stdout.readableEnded = false;
  child.stderr.readableEnded = false;
  const chunks = [];
  const runner = createGaugeProcessRunner({
    outputChannel: new FakeOutputChannel(),
    processOutputChunk(chunk) {
      chunks.push(chunk);
    },
    spawn() {
      return child;
    },
  });

  const run = runner({
    command: "gauge",
    args: ["run", "specs/example.spec"],
    cwd: "/workspace",
    forwardOutput: true,
  });
  child.emit("exit", 0);
  child.stdout.emit("data", "final output\n");
  child.stdout.readableEnded = true;
  child.stderr.readableEnded = true;
  child.emit("close", 0);

  assert.equal(await run, true);
  assert.equal(chunks.join(""), "final output\n");
});

test("process runner uses Command object spawning when available", async () => {
  const { createGaugeProcessRunner } = require("../../src/execution/processRunner");
  const child = createChildProcess();
  const outputChannel = new FakeOutputChannel();
  const toolSpawns = [];
  const fallbackSpawns = [];
  const commandTool = {
    command: "./gradlew",
    argsForSpawnType(args) {
      return args.map((arg) => `wrapped:${arg}`);
    },
    spawn(args, options) {
      toolSpawns.push({ args, options });
      return child;
    },
  };
  const runner = createGaugeProcessRunner({
    outputChannel,
    spawn(command, args, options) {
      fallbackSpawns.push({ command, args, options });
      return child;
    },
  });

  const run = runner({
    command: "./gradlew",
    tool: commandTool,
    args: ["clean", "gauge"],
    cwd: "/workspace",
  });

  child.emit("exit", 0);

  assert.equal(await run, true);
  assert.deepEqual(fallbackSpawns, []);
  assert.deepEqual(toolSpawns, [
    {
      args: ["clean", "gauge"],
      options: {
        cwd: "/workspace",
        detached: process.platform !== "win32",
        env: process.env,
      },
    },
  ]);
  assert.ok(outputChannel.lines.includes("Running tool: ./gradlew wrapped:clean wrapped:gauge"));
});

test("process runner adds configured GAUGE_HOME to the base environment", async () => {
  const { createGaugeProcessRunner } = require("../../src/execution/processRunner");
  const child = createChildProcess();
  const outputChannel = new FakeOutputChannel();
  const spawnCalls = [];
  const runner = createGaugeProcessRunner({
    outputChannel,
    env: { PATH: "/bin" },
    vscode: {
      workspace: {
        getConfiguration(section) {
          assert.equal(section, "gauge");
          return {
            get(key) {
              return key === "home" ? "/custom/gauge-home" : "";
            },
          };
        },
      },
    },
    spawn(command, args, options) {
      spawnCalls.push({ command, args, options });
      return child;
    },
  });

  const run = runner({
    command: "gauge",
    args: ["run"],
    cwd: "/workspace",
  });

  child.emit("exit", 0);

  assert.equal(await run, true);
  assert.deepEqual(spawnCalls[0].options.env, {
    PATH: "/bin",
    GAUGE_HOME: "/custom/gauge-home",
  });
});

test("process runner reports failed exits", async () => {
  const { createGaugeProcessRunner } = require("../../src/execution/processRunner");
  const child = createChildProcess();
  const outputChannel = new FakeOutputChannel();
  const runner = createGaugeProcessRunner({
    outputChannel,
    spawn() {
      return child;
    },
  });

  const run = runner({
    command: "gauge",
    args: ["run"],
    cwd: "/workspace",
  });

  child.emit("exit", 1);

  assert.equal(await run, false);
  assert.equal(outputChannel.lines.at(-1), "Error: Tests failed.");
});

test("process runner cancel reports an aborted run after process group termination", async () => {
  const { createGaugeProcessRunner } = require("../../src/execution/processRunner");
  const child = createChildProcess();
  const outputChannel = new FakeOutputChannel();
  const killed = [];
  const runner = createGaugeProcessRunner({
    outputChannel,
    platform: "darwin",
    killProcess(pid) {
      killed.push(pid);
    },
    spawn() {
      return child;
    },
  });

  const run = runner({
    command: "gauge",
    args: ["run"],
    cwd: "/workspace",
  });

  run.cancel();
  child.emit("exit", null);

  assert.equal(await run, false);
  assert.deepEqual(killed, [-2468]);
  assert.deepEqual(child.killCalls, []);
  assert.equal(outputChannel.lines.at(-1), "Run stopped by user.");
});

test("process runner cancel ignores missing non-Windows process groups", async () => {
  const { createGaugeProcessRunner } = require("../../src/execution/processRunner");
  const child = createChildProcess();
  const outputChannel = new FakeOutputChannel();
  const runner = createGaugeProcessRunner({
    outputChannel,
    platform: "darwin",
    killProcess() {
      const error = new Error("missing process");
      error.code = "ESRCH";
      throw error;
    },
    spawn() {
      return child;
    },
  });

  const run = runner({
    command: "gauge",
    args: ["run"],
    cwd: "/workspace",
  });

  run.cancel();
  child.emit("exit", null);

  assert.equal(await run, false);
  assert.deepEqual(child.killCalls, []);
  assert.equal(outputChannel.lines.at(-1), "Run stopped by user.");
});

test("process runner cancel terminates Windows child process trees", async () => {
  const { createGaugeProcessRunner } = require("../../src/execution/processRunner");
  const child = createChildProcess();
  const outputChannel = new FakeOutputChannel();
  const treeLookups = [];
  const killed = [];
  const runner = createGaugeProcessRunner({
    outputChannel,
    platform: "win32",
    processTree(pid, callback) {
      treeLookups.push(pid);
      callback(null, [
        { PID: "3001" },
        { PID: 3002 },
      ]);
    },
    killProcess(pid) {
      killed.push(pid);
    },
    spawn() {
      return child;
    },
  });

  const run = runner({
    command: "gauge",
    args: ["run"],
    cwd: "/workspace",
  });

  run.cancel();
  child.emit("exit", null);

  assert.equal(await run, false);
  assert.deepEqual(treeLookups, [2468]);
  assert.deepEqual(killed, [3001, 3002, 2468]);
  assert.deepEqual(child.killCalls, []);
  assert.equal(outputChannel.lines.at(-1), "Run stopped by user.");
});

test("process runner cancel kills the Windows parent before async tree lookup completes", async () => {
  const { createGaugeProcessRunner } = require("../../src/execution/processRunner");
  const child = createChildProcess();
  const outputChannel = new FakeOutputChannel();
  const killed = [];
  let treeCallback;
  const runner = createGaugeProcessRunner({
    outputChannel,
    platform: "win32",
    processTree(_pid, callback) {
      treeCallback = callback;
    },
    killProcess(pid) {
      killed.push(pid);
    },
    spawn() {
      return child;
    },
  });

  const run = runner({
    command: "gauge",
    args: ["run"],
    cwd: "/workspace",
  });

  run.cancel();
  assert.deepEqual(killed, [2468]);

  treeCallback(null, [
    { PID: "3001" },
    { PID: 3002 },
  ]);
  child.emit("exit", null);

  assert.equal(await run, false);
  assert.deepEqual(killed, [2468, 3001, 3002]);
  assert.deepEqual(child.killCalls, []);
  assert.equal(outputChannel.lines.at(-1), "Run stopped by user.");
});
