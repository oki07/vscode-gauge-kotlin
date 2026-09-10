"use strict";

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

module.exports = { specFileFromExecutionIdentifier };
