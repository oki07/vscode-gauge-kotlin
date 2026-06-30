const assert = require("node:assert/strict");
const test = require("node:test");

test("GaugeEnterHandler saves Gauge documents after newline edits", () => {
  const { GaugeEnterHandler } = require("../src/gaugeEnterHandler");
  const listeners = [];
  const vscode = {
    workspace: {
      onDidChangeTextDocument(listener) {
        listeners.push(listener);
        return { dispose() {} };
      },
    },
  };
  const saves = [];
  const handler = new GaugeEnterHandler({ vscode });
  const disposable = handler.register();

  assert.ok(disposable);
  assert.equal(listeners.length, 1);

  listeners[0]({
    document: {
      languageId: "gauge",
      save() {
        saves.push("saved");
      },
    },
    contentChanges: [{ text: "\n" }],
  });

  assert.deepEqual(saves, ["saved"]);
});

test("GaugeEnterHandler saves Markdown Gauge specifications after newline edits", () => {
  const { GaugeEnterHandler } = require("../src/gaugeEnterHandler");
  const listeners = [];
  const vscode = {
    workspace: {
      onDidChangeTextDocument(listener) {
        listeners.push(listener);
        return { dispose() {} };
      },
    },
  };
  const checkedFiles = [];
  const projectFactory = {
    getGaugeRootFromFilePath(file) {
      checkedFiles.push(file);
      return "/workspace/gauge";
    },
  };
  const saves = [];
  const handler = new GaugeEnterHandler({ vscode, projectFactory });
  handler.register();

  listeners[0]({
    document: {
      languageId: "markdown",
      uri: { fsPath: "/workspace/gauge/specs/example.md" },
      save() {
        saves.push("saved");
      },
    },
    contentChanges: [{ text: "\n" }],
  });

  assert.deepEqual(checkedFiles, ["/workspace/gauge/specs/example.md"]);
  assert.deepEqual(saves, ["saved"]);
});

test("GaugeEnterHandler ignores Markdown files when the resolved root is not a Gauge project", () => {
  const { GaugeEnterHandler } = require("../src/gaugeEnterHandler");
  const listeners = [];
  const vscode = {
    workspace: {
      onDidChangeTextDocument(listener) {
        listeners.push(listener);
        return { dispose() {} };
      },
    },
  };
  const saves = [];
  const handler = new GaugeEnterHandler({
    vscode,
    projectFactory: {
      getGaugeRootFromFilePath(file) {
        assert.equal(file, "/workspace/notes/example.md");
        return "/workspace/notes";
      },
      isGaugeProject(root) {
        assert.equal(root, "/workspace/notes");
        return false;
      },
    },
  });
  handler.register();

  listeners[0]({
    document: {
      languageId: "markdown",
      uri: { fsPath: "/workspace/notes/example.md" },
      save() {
        saves.push("saved");
      },
    },
    contentChanges: [{ text: "\n" }],
  });

  assert.deepEqual(saves, []);
});

test("GaugeEnterHandler ignores non-Gauge documents and non-newline edits", () => {
  const { GaugeEnterHandler } = require("../src/gaugeEnterHandler");
  const listeners = [];
  const vscode = {
    workspace: {
      onDidChangeTextDocument(listener) {
        listeners.push(listener);
        return { dispose() {} };
      },
    },
  };
  const saves = [];
  const handler = new GaugeEnterHandler({ vscode });
  handler.register();

  listeners[0]({
    document: {
      languageId: "kotlin",
      save() {
        saves.push("kotlin");
      },
    },
    contentChanges: [{ text: "\n" }],
  });
  listeners[0]({
    document: {
      languageId: "gauge",
      save() {
        saves.push("gauge");
      },
    },
    contentChanges: [{ text: "step" }],
  });

  assert.deepEqual(saves, []);
});
