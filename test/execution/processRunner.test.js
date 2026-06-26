const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const test = require("node:test");

class FakeOutputChannel {
  constructor() {
    this.lines = [];
  }

  appendLine(value) {
    this.lines.push(value);
  }

  clear() {
    this.lines = [];
  }

  show() {}
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

  const runner = createGaugeProcessRunner({
    pathModule: path.posix,
    outputChannel,
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
