const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { KotlinSourceScope } = require("../src/kotlinSourceScope");

// Kotlin LSP 0.0.12 exportWorkspace and workspace/symbol agree for conventional
// roots, content-only files, literal excludedPatterns, and model reloads.
function model(source = "/workspace/gauge/src") {
  return { modules: [{ name: "gauge", contentRoots: [{
    path: "/workspace/gauge", excludedPatterns: ["excluded"],
    sourceRoots: [{ path: source, type: "java-test" }, {
      path: "/workspace/gauge/resources", type: "java-resource",
    }],
  }] }] };
}

function fixture() {
  const state = { model: model(), exports: [], fail: false };
  const vscode = {
    extensions: { getExtension: () => ({ isActive: true }) },
    commands: {
      getCommands: async () => ["exportWorkspace"],
      async executeCommand(command, directory) {
        assert.equal(command, "exportWorkspace");
        state.exports.push(directory);
        if (state.fail) throw new Error("Server unavailable");
        await fs.writeFile(path.join(directory, "workspace.json"), JSON.stringify(state.model));
        return null;
      },
    },
  };
  return { state, scope: new KotlinSourceScope({ vscode }) };
}

test("Kotlin source scope uses imported roots and retains the last exported model on failure", async () => {
  const { state, scope } = fixture();
  let changes = 0;
  const subscription = scope.onDidChange(() => { changes += 1; });
  try {
    assert.equal(scope.allows("/workspace/gauge/notes/Notes.kt"), undefined);
    await scope.refresh();
    assert.equal(scope.allows("/workspace/gauge/src/Source.kt"), true);
    assert.equal(scope.allows("/workspace/gauge/src/Source.java"), true);
    assert.equal(scope.allows("/workspace/gauge/notes/Notes.kt"), false);
    assert.equal(scope.allows("/workspace/gauge/src/excluded/No.kt"), false);
    assert.equal(scope.allows("/workspace/gauge/src/excludedSibling/Yes.kt"), true);
    // IDEA 2020.1 annotation search includes Kotlin resource sources, but not Java.
    assert.equal(scope.allows("/workspace/gauge/resources/Resource.kt"), true);
    assert.equal(scope.allows("/workspace/gauge/resources/Resource.java"), false);
    assert.equal(scope.allows("/workspace/other/Source.kt"), undefined);
    assert.equal(changes, 1);
    await scope.refresh();
    assert.equal(changes, 1);
    state.fail = true;
    await scope.refresh();
    assert.equal(scope.allows("/workspace/gauge/notes/Notes.kt"), false);
    assert.equal(changes, 1);
    state.fail = false;
    state.model = model("/workspace/gauge/notes");
    await scope.refresh();
    assert.equal(scope.allows("/workspace/gauge/notes/Notes.kt"), true);
    assert.equal(scope.allows("/workspace/gauge/src/Source.kt"), false);
    assert.equal(changes, 2);
    for (const directory of state.exports) await assert.rejects(fs.stat(directory), { code: "ENOENT" });
  } finally {
    subscription.dispose();
    scope.dispose();
  }
});

test("Kotlin source scope does not publish an export after disposal", async () => {
  let release;
  let entered;
  const entering = new Promise((resolve) => { entered = resolve; });
  const ready = new Promise((resolve) => { release = resolve; });
  const { state, scope } = fixture();
  const execute = scope.vscode.commands.executeCommand;
  scope.vscode.commands.executeCommand = async (...args) => { entered(); await ready; return execute(...args); };
  let changes = 0;
  scope.onDidChange(() => { changes += 1; });
  const pending = scope.refresh();
  await entering;
  scope.dispose();
  release();
  await pending;
  assert.equal(changes, 0);
  assert.equal(state.exports.length, 1);
  assert.equal(scope.allows("/workspace/gauge/notes/Notes.kt"), undefined);
  for (const directory of state.exports) await assert.rejects(fs.stat(directory), { code: "ENOENT" });
});
