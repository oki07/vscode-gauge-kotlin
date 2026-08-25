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

test("GaugeWorkspaceFeature replaces saveFiles handlers across clear and restart", async () => {
  const { GaugeWorkspaceFeature } = require("../src/gaugeWorkspaceFeature");
  const registrations = [];
  const saves = [];
  const client = {
    onRequest(method, handler) {
      const registration = {
        disposeCalls: 0,
        handler,
        method,
        dispose() {
          this.disposeCalls += 1;
          if (registrations.indexOf(this) === 0) {
            throw new Error("saveFiles registration cleanup failed");
          }
        },
      };
      registrations.push(registration);
      return registration;
    },
  };
  const feature = new GaugeWorkspaceFeature(client, {
    vscode: {
      workspace: {
        saveAll(includeUntitled) {
          saves.push(includeUntitled);
          return Promise.resolve(true);
        },
      },
    },
  });

  feature.initialize();
  feature.initialize();
  const oldHandler = registrations[0].handler;
  feature.clear();
  feature.clear();
  const oldResult = await oldHandler();
  feature.initialize();
  const currentResult = await registrations[1].handler();
  const retainedResult = await oldHandler();
  feature.clear();

  assert.equal(oldResult, null);
  assert.equal(currentResult, null);
  assert.equal(retainedResult, null);
  assert.deepEqual(saves, [false]);
  assert.equal(registrations.length, 2);
  assert.deepEqual(registrations.map((registration) => registration.disposeCalls), [1, 1]);
});

test("GaugeWorkspaceFeature preserves live registration and saveFiles failures", async () => {
  const { GaugeWorkspaceFeature } = require("../src/gaugeWorkspaceFeature");
  const registrationError = new Error("saveFiles registration failed");
  const synchronousSaveError = new Error("synchronous workspace save failed");
  const asynchronousSaveError = new Error("asynchronous workspace save failed");
  const registrations = [];
  let registrationCalls = 0;
  let saveFailure = synchronousSaveError;
  const client = {
    onRequest(_method, handler) {
      registrationCalls += 1;
      if (registrationCalls === 1) {
        throw registrationError;
      }
      const registration = {
        disposeCalls: 0,
        handler,
        dispose() {
          this.disposeCalls += 1;
        },
      };
      registrations.push(registration);
      return registration;
    },
  };
  const feature = new GaugeWorkspaceFeature(client, {
    vscode: {
      workspace: {
        saveAll() {
          if (saveFailure === synchronousSaveError) {
            throw saveFailure;
          }
          return Promise.reject(saveFailure);
        },
      },
    },
  });

  assert.throws(
    () => feature.initialize(),
    (error) => error === registrationError,
  );
  feature.initialize();
  assert.throws(
    () => registrations[0].handler(),
    (error) => error === synchronousSaveError,
  );
  saveFailure = asynchronousSaveError;
  await assert.rejects(
    registrations[0].handler(),
    (error) => error === asynchronousSaveError,
  );
  feature.clear();

  assert.equal(registrationCalls, 2);
  assert.equal(registrations[0].disposeCalls, 1);
});

test("GaugeWorkspaceFeature terminal disposal closes its saveFiles handler", async () => {
  const { GaugeWorkspaceFeature } = require("../src/gaugeWorkspaceFeature");
  const registrations = [];
  const saves = [];
  const client = {
    onRequest(_method, handler) {
      const registration = {
        disposeCalls: 0,
        handler,
        dispose() {
          this.disposeCalls += 1;
        },
      };
      registrations.push(registration);
      return registration;
    },
  };
  const feature = new GaugeWorkspaceFeature(client, {
    vscode: {
      workspace: {
        saveAll(includeUntitled) {
          saves.push(includeUntitled);
          return Promise.resolve(true);
        },
      },
    },
  });

  feature.initialize();
  const retainedHandler = registrations[0].handler;
  feature.dispose();
  feature.dispose();
  const retainedResult = await retainedHandler();
  feature.initialize();

  assert.equal(retainedResult, null);
  assert.deepEqual(saves, []);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].disposeCalls, 1);
});

test("GaugeWorkspaceFeature preserves active saves across lifecycle reentrancy", async () => {
  const { GaugeWorkspaceFeature } = require("../src/gaugeWorkspaceFeature");
  const saveError = new Error("active workspace save failed");
  const registrations = [];
  let feature;
  let reenterRegistration = true;
  const client = {
    onRequest(_method, handler) {
      const registration = {
        disposeCalls: 0,
        handler,
        dispose() {
          this.disposeCalls += 1;
        },
      };
      registrations.push(registration);
      if (reenterRegistration) {
        reenterRegistration = false;
        feature.clear();
      }
      return registration;
    },
  };
  feature = new GaugeWorkspaceFeature(client, {
    vscode: {
      workspace: {
        saveAll() {
          feature.clear();
          return Promise.reject(saveError);
        },
      },
    },
  });

  feature.initialize();
  const staleResult = await registrations[0].handler();
  feature.initialize();
  await assert.rejects(
    registrations[1].handler(),
    (error) => error === saveError,
  );
  const retainedResult = await registrations[1].handler();

  assert.equal(staleResult, null);
  assert.equal(retainedResult, null);
  assert.deepEqual(registrations.map((registration) => registration.disposeCalls), [1, 1]);
});
