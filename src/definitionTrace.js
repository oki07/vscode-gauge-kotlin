"use strict";

// Runtime instrumentation for "Go to Definition" from a Gauge step to its Kotlin
// @Step implementation. Writes a measured trace of every decision point to a
// dedicated VS Code output channel ("Gauge Definition Trace") so failures can be
// observed instead of guessed. A no-op when no output channel is available
// (unit tests), so it never changes provider behavior.

const CHANNEL_NAME = "Gauge Definition Trace";
const TRACE_VERSION = "def-trace/1";

let sharedChannel;

function resolveChannel(vscode) {
  if (sharedChannel) {
    return sharedChannel;
  }
  const window = vscode && vscode.window;
  if (window && typeof window.createOutputChannel === "function") {
    try {
      sharedChannel = window.createOutputChannel(CHANNEL_NAME);
    } catch (_error) {
      sharedChannel = undefined;
    }
  }
  return sharedChannel;
}

function timestamp() {
  try {
    return new Date().toISOString();
  } catch (_error) {
    return "";
  }
}

const NULL_TRACE = {
  enabled: false,
  log() {},
  flush() {},
};

function createDefinitionTrace(vscode) {
  const channel = resolveChannel(vscode);
  if (!channel) {
    return NULL_TRACE;
  }
  const lines = [];
  return {
    enabled: true,
    log(message) {
      lines.push(message);
    },
    flush(options = {}) {
      channel.appendLine(`---- ${timestamp()} [${TRACE_VERSION}] ----`);
      for (const line of lines) {
        channel.appendLine(line);
      }
      if (options.reveal !== false && typeof channel.show === "function") {
        channel.show(true);
      }
    },
  };
}

module.exports = { createDefinitionTrace, NULL_TRACE, TRACE_VERSION, CHANNEL_NAME };
