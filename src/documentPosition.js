"use strict";

function fallbackPositionAt(text, offset) {
  const value = String(text || "");
  const boundedOffset = Math.max(0, Math.min(offset, value.length));
  let line = 0;
  let lineStart = 0;
  for (let index = 0; index < boundedOffset; index += 1) {
    if (value[index] === "\n") {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, character: boundedOffset - lineStart };
}

function positionAt(document, text, offset) {
  if (document && typeof document.positionAt === "function") {
    return document.positionAt(offset);
  }
  return fallbackPositionAt(text, offset);
}

function fallbackOffsetAt(text, position) {
  const value = String(text || "");
  let offset = 0;
  let line = 0;
  while (line < position.line && offset < value.length) {
    const nextLine = value.indexOf("\n", offset);
    if (nextLine === -1) {
      return value.length;
    }
    offset = nextLine + 1;
    line += 1;
  }
  return Math.min(offset + position.character, value.length);
}

function offsetAt(document, text, position) {
  if (document && typeof document.offsetAt === "function") {
    return document.offsetAt(position);
  }
  return fallbackOffsetAt(text, position);
}

module.exports = {
  fallbackOffsetAt,
  fallbackPositionAt,
  offsetAt,
  positionAt,
};
