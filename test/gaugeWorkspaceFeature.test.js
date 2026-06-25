const assert = require("node:assert/strict");
const test = require("node:test");

test("GaugeWorkspaceFeature advertises and handles workspace saveFiles requests", async () => {
  const { GaugeWorkspaceFeature } = require("../src/gaugeWorkspaceFeature");
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
  assert.equal(feature.messages.method, "workspace/saveFiles");
  assert.deepEqual(requests.map((request) => request.method), ["workspace/saveFiles"]);
  assert.deepEqual(saves, [false]);
  assert.equal(result, null);
  assert.deepEqual(feature.getState(), {
    kind: "workspace",
    id: undefined,
    registrations: false,
  });
});
