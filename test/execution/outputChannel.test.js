const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

class MockOutputChannel {
  constructor() {
    this.text = "";
    this.lines = [];
  }

  appendLine(value) {
    this.text = value;
    this.lines.push(value);
  }

  clear() {
    this.text = "";
    this.lines = [];
  }

  show() {}
}

test("OutputChannel converts specification paths from relative to absolute", () => {
  const { OutputChannel } = require("../../src/execution/outputChannel");
  const channel = new MockOutputChannel();
  const outputChannel = new OutputChannel(channel, "", "project", { pathModule: path.posix });

  outputChannel.appendOutBuf(`      Specification: ${path.posix.join("specs", "example.spec:19")}\n`);

  assert.equal(
    channel.text,
    `      Specification: ${path.posix.join("project", "specs", "example.spec:19")}`,
  );
});

test("OutputChannel converts implementation paths from relative to absolute", () => {
  const { OutputChannel } = require("../../src/execution/outputChannel");
  const channel = new MockOutputChannel();
  const outputChannel = new OutputChannel(channel, "", "project", { pathModule: path.posix });

  outputChannel.appendOutBuf(
    `      at Object.<anonymous> (${path.posix.join("tests", "step_implementation.js:24:10")})\n`,
  );

  assert.equal(
    channel.text,
    `      at Object.<anonymous> (${path.posix.join("project", "tests", "step_implementation.js:24:10)")}`,
  );
});

test("OutputChannel does not rewrite absolute implementation paths", () => {
  const { OutputChannel } = require("../../src/execution/outputChannel");
  const channel = new MockOutputChannel();
  const outputChannel = new OutputChannel(channel, "", "projectRoot", { pathModule: path.posix });

  outputChannel.appendOutBuf(
    `      at Object.<anonymous> (${path.posix.join("projectRoot", "tests", "step_implementation.js:24:10")})\n`,
  );

  assert.equal(
    channel.text,
    `      at Object.<anonymous> (${path.posix.join("projectRoot", "tests", "step_implementation.js:24:10)")}`,
  );
});

test("OutputChannel reports finish status", () => {
  const { OutputChannel } = require("../../src/execution/outputChannel");
  const channel = new MockOutputChannel();
  const outputChannel = new OutputChannel(channel, "", "project", { pathModule: path.posix });
  let resolved;

  outputChannel.onFinish((value) => {
    resolved = value;
  }, 0, "Success: Tests passed.", "Error: Tests failed.", false);

  assert.equal(resolved, true);
  assert.equal(channel.text, "Success: Tests passed.");
});
