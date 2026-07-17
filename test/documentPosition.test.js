"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  offsetAt,
  positionAt,
} = require("../src/documentPosition");

test("document positions use the TextDocument line index when available", () => {
  const calls = [];
  const document = {
    offsetAt(position) {
      calls.push(["offsetAt", position]);
      return 1234;
    },
    positionAt(offset) {
      calls.push(["positionAt", offset]);
      return { line: 98, character: 7 };
    },
  };
  const position = { line: 80, character: 4 };

  assert.equal(offsetAt(document, "fallback text", position), 1234);
  assert.deepEqual(positionAt(document, "fallback text", 4567), { line: 98, character: 7 });
  assert.deepEqual(calls, [
    ["offsetAt", position],
    ["positionAt", 4567],
  ]);
});

test("document positions retain a fallback for lightweight documents", () => {
  const text = "first\nsecond\nthird";

  assert.equal(offsetAt(undefined, text, { line: 1, character: 3 }), 9);
  assert.deepEqual(positionAt(undefined, text, 9), { line: 1, character: 3 });
});
