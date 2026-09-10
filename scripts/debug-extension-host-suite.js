"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

async function within(milliseconds, operation) {
  let timer;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Debugger verification timed out")), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Run with --extensionTestsPath in a compiled bundled Maven project and an
// isolated profile containing an initialized fwcd.kotlin debug adapter.
async function run() {
  const adapter = vscode.extensions.getExtension("fwcd.kotlin");
  assert.ok(adapter, "Install and initialize the Kotlin debug adapter in the test profile");
  await within(45000, () => adapter.activate());
  const gauge = vscode.extensions.getExtension("oki07.vscode-gauge-kotlin");
  assert.ok(gauge, "Gauge Kotlin is installed");
  await within(45000, () => gauge.activate());
  const projectRoot = fs.realpathSync(vscode.workspace.workspaceFolders[0].uri.fsPath);
  const logPath = path.join(projectRoot, "logs", "gauge.log");
  const beforeLog = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8").length : 0;
  const source = vscode.Uri.file(path.join(projectRoot, "src/test/kotlin/example/StepImplementation.kt"));
  const document = await vscode.workspace.openTextDocument(source);
  const line = document.getText().split("\n").findIndex((text) => text.includes("vowels = vowelString"));
  assert.ok(line >= 0, "The compiled bundled Kotlin implementation is present");
  const breakpoint = new vscode.SourceBreakpoint(new vscode.Location(source, new vscode.Position(line, 0)));
  vscode.debug.addBreakpoints([breakpoint]);
  const activeThreads = new Set();
  const stopTasks = [];
  let stops = 0;
  let failure;
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory("kotlin", {
    createDebugAdapterTracker(session) {
      assert.equal(session.configuration.projectRoot, projectRoot);
      assert.equal(session.configuration.request, "attach");
      return {
        onDidSendMessage(message) {
          if (message.type !== "event" || message.event !== "stopped"
            || activeThreads.has(message.body.threadId)) {
            return;
          }
          const threadId = message.body.threadId;
          // The adapter can emit duplicate stopped events for one suspension.
          activeThreads.add(threadId);
          const task = (async () => {
            const stack = await session.customRequest("stackTrace", { threadId, startFrame: 0, levels: 20 });
            assert.ok(stack.stackFrames.some((frame) => frame.source
              && typeof frame.source.path === "string"
              && frame.source.path.endsWith("StepImplementation.kt") && frame.line === line + 1),
            "The breakpoint reaches the expected Kotlin source line");
            stops += 1;
            process.stdout.write(`PASS Kotlin breakpoint at line ${line + 1}\n`);
            // Allow the editor's own stack/variable requests to settle before
            // resuming the same thread through this automated test.
            await new Promise((resolve) => setTimeout(resolve, 150));
            await session.customRequest("continue", { threadId });
            activeThreads.delete(threadId);
          })().catch(async (error) => {
            failure = error;
            await vscode.commands.executeCommand("gauge.stopExecution");
          });
          stopTasks.push(task);
        },
      };
    },
  });
  try {
    await within(120000, () => vscode.commands.executeCommand("gauge.debug", path.join(projectRoot, "specs/example.spec")));
    await Promise.all(stopTasks);
    if (failure) {
      throw failure;
    }
    assert.ok(stops > 0, "The installed Kotlin adapter reached a breakpoint");
    // Gauge writes its result before terminating the debugger. The command's
    // return value does not encode that result, so inspect this run's log.
    const log = fs.readFileSync(logPath, "utf8").slice(beforeLog);
    assert.match(log, /Specifications:\s+1 executed\s+1 passed\s+0 failed\s+0 skipped/);
    assert.match(log, /Scenarios:\s+2 executed\s+2 passed\s+0 failed\s+0 skipped/);
    process.stdout.write(`PASS debug execution in VS Code ${vscode.version}\n`);
  } finally {
    vscode.debug.removeBreakpoints([breakpoint]);
    await vscode.commands.executeCommand("gauge.stopExecution");
    const session = vscode.debug.activeDebugSession;
    if (session && session.name === "Gauge Debugger") {
      await vscode.debug.stopDebugging(session);
    }
    tracker.dispose();
  }
}

module.exports = { run };
