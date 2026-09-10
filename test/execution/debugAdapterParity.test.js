"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createGaugeDebugger } = require("../../src/execution/debug");
const cases = require("../fixtures/debug-adapter-parity.json");

// fwcd/vscode-kotlin package.json contributes the "kotlin" debug type and
// requires projectRoot, hostName, port, and timeout for attach. VS Code with
// fwcd.kotlin 0.2.36 reports "kotlin" in its available types, without "java".
// Gauge's Java runner can execute Kotlin classes, so both runner names use
// the installed JVM adapter.
for (const fixture of cases) {
  test(`installed debug adapter: ${fixture.name}`, () => {
    const vscode = {
      extensions: {
        all: [
          { packageJSON: {} },
          ...fixture.adapters.map((type) => ({
            packageJSON: { contributes: { debuggers: [{ type }] } },
          })),
        ],
      },
    };
    const debuggerSession = createGaugeDebugger({
      vscode,
      projectRoot: "/workspace/gauge",
      language: fixture.language,
      debugPort: 5005,
    });
    const configuration = debuggerSession.getDebuggerConfiguration();
    assert.equal(configuration.type, fixture.type);
    assert.equal(configuration.request, "attach");
    assert.equal(configuration.port, 5005);
    if (fixture.type === "kotlin") {
      assert.equal(configuration.projectRoot, "/workspace/gauge");
      assert.equal(configuration.hostName, "127.0.0.1");
      assert.equal(configuration.timeout, 30000);
    }
  });
}
