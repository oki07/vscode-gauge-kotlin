const assert = require("node:assert/strict");
const test = require("node:test");

function createFakeVscode(overrides = {}) {
  const commands = [];
  const errors = [];
  const information = [];
  const updates = [];
  const vscode = {
    Uri: {
      parse(uri) {
        return { uri };
      },
    },
    commands: {
      executeCommand(command, ...args) {
        commands.push({ command, args });
        return Promise.resolve(undefined);
      },
    },
    window: {
      showErrorMessage(message) {
        errors.push(message);
        return Promise.resolve(undefined);
      },
      showInformationMessage(message, ...items) {
        information.push({ message, items });
        return Promise.resolve(overrides.selection);
      },
    },
    workspace: {
      getConfiguration(section) {
        return {
          get(key) {
            assert.equal(section, "gauge.welcomeNotification");
            assert.equal(key, "showOn");
            return overrides.showOn || "newProjectLoad";
          },
          update(key, value, target) {
            updates.push({ key, value, target });
            return Promise.resolve(undefined);
          },
        };
      },
    },
  };
  return {
    commands,
    errors,
    information,
    updates,
    vscode,
  };
}

test("showWelcomeNotification shows first-run help and can disable future prompts", async () => {
  const { showWelcomeNotification } = require("../src/welcomeNotifications");
  const { information, updates, vscode } = createFakeVscode({
    selection: "Do not show this again",
  });
  const stateUpdates = [];
  const context = {
    workspaceState: {
      get(key) {
        assert.equal(key, "hasOpenedBefore");
        return false;
      },
      update(key, value) {
        stateUpdates.push({ key, value });
        return Promise.resolve(undefined);
      },
    },
  };

  await showWelcomeNotification(context, vscode);

  assert.deepEqual(information, [
    {
      message: "Gauge plugin initialised.",
      items: ["Learn more", "Do not show this again"],
    },
  ]);
  assert.deepEqual(updates, [
    { key: "gauge.welcomeNotification.showOn", value: "never", target: true },
  ]);
  assert.deepEqual(stateUpdates, [{ key: "hasOpenedBefore", value: true }]);
});

test("showWelcomeNotification opens Gauge docs when requested", async () => {
  const { showWelcomeNotification } = require("../src/welcomeNotifications");
  const { commands, vscode } = createFakeVscode({
    selection: "Learn more",
  });
  const context = {
    workspaceState: {
      get() {
        return false;
      },
      update() {
        return Promise.resolve(undefined);
      },
    },
  };

  await showWelcomeNotification(context, vscode);

  assert.deepEqual(commands, [
    {
      command: "vscode.open",
      args: [{ uri: "https://docs.gauge.org" }],
    },
  ]);
});

test("showWelcomeNotification records the first run without prompting when disabled", async () => {
  const { showWelcomeNotification } = require("../src/welcomeNotifications");
  const { information, vscode } = createFakeVscode({
    showOn: "never",
  });
  const stateUpdates = [];
  const context = {
    workspaceState: {
      get() {
        return false;
      },
      update(key, value) {
        stateUpdates.push({ key, value });
        return Promise.resolve(undefined);
      },
    },
  };

  await showWelcomeNotification(context, vscode);

  assert.deepEqual(information, []);
  assert.deepEqual(stateUpdates, [{ key: "hasOpenedBefore", value: true }]);
});

test("showInstallGaugeNotification reports the Gauge install instructions", async () => {
  const { showInstallGaugeNotification } = require("../src/welcomeNotifications");
  const { errors, vscode } = createFakeVscode();

  await showInstallGaugeNotification(vscode);

  assert.match(errors[0], /Gauge executable not found/);
  assert.match(errors[0], /installing-gauge/);
});
