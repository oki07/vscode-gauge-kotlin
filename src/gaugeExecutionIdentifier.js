"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");

// Gauge discovery/reporting can return a physical path for a document opened
// through a directory alias. Resolve its existing ancestor even after deletion
// so the editor can remove the same TestItem it originally discovered.
function canonicalFilePath(file, fileSystem = nodeFs, pathModule = nodePath) {
  if (!file || typeof fileSystem.realpathSync !== "function"
    || typeof pathModule.isAbsolute !== "function" || !pathModule.isAbsolute(file)) {
    return file;
  }
  let current = file;
  const suffix = [];
  while (current) {
    try {
      return pathModule.join(String(fileSystem.realpathSync(current)), ...suffix);
    } catch (_error) {
      const parent = pathModule.dirname(current);
      if (parent === current) return file;
      suffix.unshift(pathModule.basename(current));
      current = parent;
    }
  }
  return file;
}

// getgauge/gauge/api/lang/customResponses.go appends a colon and heading line
// to the complete filename. Colons inside the filename remain part of it.
function specFileFromExecutionIdentifier(executionIdentifier, lineNo) {
  const value = String(executionIdentifier || "");
  const suffix = `:${lineNo}`;
  if (value.endsWith(suffix)) {
    return value.slice(0, -suffix.length);
  }
  return value.replace(/:\d+$/, "");
}

module.exports = { canonicalFilePath, specFileFromExecutionIdentifier };
