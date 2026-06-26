const assert = require("node:assert/strict");
const test = require("node:test");

test("LineBuffer emits complete lines and leaves the final chunk for done", () => {
  const { LineBuffer } = require("../../src/execution/lineBuffer");
  const lines = [];
  const done = [];
  const buffer = new LineBuffer();

  buffer.onLine((line) => lines.push(line));
  buffer.onDone((last) => done.push(last));
  buffer.append("first\nsec");
  buffer.append("ond\nthird");
  buffer.done();

  assert.deepEqual(lines, ["first", "second"]);
  assert.deepEqual(done, ["third"]);
});

test("LineBuffer reports null on done when no final chunk remains", () => {
  const { LineBuffer } = require("../../src/execution/lineBuffer");
  const lines = [];
  const done = [];
  const buffer = new LineBuffer();

  buffer.onLine((line) => lines.push(line));
  buffer.onDone((last) => done.push(last));
  buffer.append("first\nsecond\n");
  buffer.done();

  assert.deepEqual(lines, ["first", "second"]);
  assert.deepEqual(done, [null]);
});

test("LineBuffer keeps the final chunk available after done", () => {
  const { LineBuffer } = require("../../src/execution/lineBuffer");
  const done = [];
  const buffer = new LineBuffer();

  buffer.onDone((last) => done.push(last));
  buffer.append("partial");
  buffer.done();
  buffer.done();

  assert.deepEqual(done, ["partial", "partial"]);
});
