const assert = require("node:assert/strict");
const test = require("node:test");

test("GaugeWorkspaceFeature advertises and handles workspace saveFiles requests", async () => {
  const {
    GaugeWorkspaceFeature,
    SAVE_FILES_REQUEST,
  } = require("../src/gaugeWorkspaceFeature");
  const requests = [];
  const saves = [];
  const client = {
    onRequest(method, handler) {
      requests.push({ method, handler });
    },
  };
  const vscode = {
    workspace: {
      saveAll(includeUntitled) {
        saves.push(includeUntitled);
        return Promise.resolve(true);
      },
    },
  };
  const feature = new GaugeWorkspaceFeature(client, { vscode });
  const capabilities = {};

  feature.fillClientCapabilities(capabilities);
  feature.initialize();
  const result = await requests[0].handler();

  assert.deepEqual(capabilities, { saveFiles: true });
  assert.equal(feature.messages, SAVE_FILES_REQUEST);
  assert.equal(feature.messages.method, "workspace/saveFiles");
  assert.equal(feature.messages.numberOfParams, 0);
  assert.equal(feature.messages.parameterStructures.toString(), "auto");
  assert.deepEqual(requests.map((request) => request.method), ["workspace/saveFiles"]);
  assert.deepEqual(saves, [false]);
  assert.equal(result, null);
  assert.deepEqual(feature.getState(), {
    kind: "workspace",
    id: undefined,
    registrations: false,
  });
});

test("GaugeWorkspaceFeature unregisters and disposes dynamic listeners", () => {
  const { GaugeWorkspaceFeature } = require("../src/gaugeWorkspaceFeature");
  const disposed = [];
  const feature = new GaugeWorkspaceFeature({}, {
    vscode: {
      workspace: {
        saveAll() {
          return Promise.resolve(true);
        },
      },
    },
  });
  feature.listeners.set("one", {
    dispose() {
      disposed.push("one");
    },
  });
  feature.listeners.set("two", {
    dispose() {
      disposed.push("two");
    },
  });

  feature.unregister("missing");

  assert.deepEqual(disposed, []);
  assert.equal(feature.listeners.size, 2);
  assert.deepEqual(feature.getState(), {
    kind: "workspace",
    id: undefined,
    registrations: true,
  });

  feature.unregister("one");

  assert.deepEqual(disposed, ["one"]);
  assert.equal(feature.listeners.has("one"), false);
  assert.equal(feature.listeners.has("two"), true);
  assert.deepEqual(feature.getState(), {
    kind: "workspace",
    id: undefined,
    registrations: true,
  });

  feature.dispose();

  assert.deepEqual(disposed, ["one", "two"]);
  assert.equal(feature.listeners.size, 0);
  assert.deepEqual(feature.getState(), {
    kind: "workspace",
    id: undefined,
    registrations: false,
  });
});
