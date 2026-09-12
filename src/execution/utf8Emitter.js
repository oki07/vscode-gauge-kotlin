"use strict";

const { StringDecoder } = require("node:string_decoder");

function createUtf8Emitter(callback) {
  const decoder = new StringDecoder("utf8");
  let finished = false;
  return {
    write(chunk) {
      if (finished) {
        return;
      }
      const value = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      const text = decoder.write(value);
      if (text) {
        callback(text);
      }
    },
    finish() {
      if (finished) {
        return;
      }
      finished = true;
      const text = decoder.end();
      if (text) {
        callback(text);
      }
    },
  };
}

module.exports = { createUtf8Emitter };
