const assert = require("node:assert/strict");
const test = require("node:test");

function createFakeVscode(overrides = {}) {
  const commands = [];
  const informationPrompts = [];
  const updates = [];
  const inspected = {
    "files.associations": { workspaceValue: { "*.md": "markdown" } },
    "files.autoSave": { globalValue: "afterDelay" },
    "files.autoSaveDelay": { globalValue: 500 },
    "gauge.recommendedSettings.options": { globalValue: "Ignore" },
    ...overrides.inspected,
  };
  const vscode = {
    ConfigurationTarget: {
      Global: "global",
      Workspace: "workspace",
    },
    commands: {
      executeCommand(command) {
        commands.push({ command });
        return Promise.resolve(undefined);
      },
      registerCommand(command, handler) {
        commands.push({ command, handler });
        return { dispose() {} };
      },
    },
    window: {
      showInformationMessage(message, ...actions) {
        informationPrompts.push({ message, actions });
        return Promise.resolve(overrides.informationSelection);
      },
    },
    workspace: {
      getConfiguration() {
        return {
          inspect(key) {
            return inspected[key] || {};
          },
          update(key, value, target) {
            updates.push({ key, value, target });
            inspected[key] = target === "global"
              ? { globalValue: value }
              : { workspaceValue: value };
            return Promise.resolve(undefined);
          },
        };
      },
    },
  };
  return {
    commands,
    informationPrompts,
    inspected,
    updates,
    vscode,
  };
}

function needsRecommendedSettings(optionValue) {
  return {
    "files.autoSave": { globalValue: "off" },
    "files.autoSaveDelay": { globalValue: 1000 },
    "gauge.recommendedSettings.options": { globalValue: optionValue },
  };
}

function flushAsyncWork() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

test("ConfigProvider applies Gauge file associations and recommended settings", async () => {
  const { ConfigProvider } = require("../src/config/configProvider");
  const { commands, updates, vscode } = createFakeVscode();

  new ConfigProvider({ subscriptions: [] }, { vscode });

  const command = commands.find((entry) => entry.command === "gauge.config.saveRecommended");
  assert.ok(command);
  assert.deepEqual(updates, [
    {
      key: "files.associations",
      value: {
        "*.md": "markdown",
        "*.spec": "gauge",
        "*.cpt": "gauge",
      },
      target: "workspace",
    },
  ]);

  await command.handler();

  assert.deepEqual(updates.slice(1), [
    { key: "files.autoSave", value: "afterDelay", target: "workspace" },
    { key: "files.autoSaveDelay", value: 500, target: "workspace" },
  ]);
  assert.deepEqual(commands.at(-1), { command: "workbench.action.reloadWindow" });
});

test("ConfigProvider applies and reloads when the user accepts recommended settings", async () => {
  const { ConfigProvider } = require("../src/config/configProvider");
  const {
    commands,
    informationPrompts,
    updates,
    vscode,
  } = createFakeVscode({
    informationSelection: "Apply & Reload",
    inspected: needsRecommendedSettings(undefined),
  });

  new ConfigProvider({ subscriptions: [] }, { vscode });
  await flushAsyncWork();

  assert.deepEqual(informationPrompts, [
    {
      message: "Gauge recommends some settings for best experience with Visual Studio Code.",
      actions: ["Apply & Reload", "Remind me later", "Ignore"],
    },
  ]);
  assert.deepEqual(updates.slice(1), [
    { key: "files.autoSave", value: "afterDelay", target: "workspace" },
    { key: "files.autoSaveDelay", value: 500, target: "workspace" },
    { key: "gauge.recommendedSettings.options", value: "Apply & Reload", target: "global" },
  ]);
  assert.deepEqual(commands.at(-1), { command: "workbench.action.reloadWindow" });
});

test("ConfigProvider stores Ignore without reloading when the user rejects recommended settings", async () => {
  const { ConfigProvider } = require("../src/config/configProvider");
  const {
    commands,
    informationPrompts,
    updates,
    vscode,
  } = createFakeVscode({
    informationSelection: "Ignore",
    inspected: needsRecommendedSettings(undefined),
  });

  new ConfigProvider({ subscriptions: [] }, { vscode });
  await flushAsyncWork();

  assert.deepEqual(informationPrompts, [
    {
      message: "Gauge recommends some settings for best experience with Visual Studio Code.",
      actions: ["Apply & Reload", "Remind me later", "Ignore"],
    },
  ]);
  assert.deepEqual(updates.slice(1), [
    { key: "gauge.recommendedSettings.options", value: "Ignore", target: "global" },
  ]);
  assert.equal(commands.some((entry) => entry.command === "workbench.action.reloadWindow"), false);
});

test("ConfigProvider stores Remind me later only when it is not already selected", async () => {
  const { ConfigProvider } = require("../src/config/configProvider");
  const first = createFakeVscode({
    informationSelection: "Remind me later",
    inspected: needsRecommendedSettings(undefined),
  });
  const second = createFakeVscode({
    informationSelection: "Remind me later",
    inspected: needsRecommendedSettings("Remind me later"),
  });

  new ConfigProvider({ subscriptions: [] }, { vscode: first.vscode });
  await flushAsyncWork();
  new ConfigProvider({ subscriptions: [] }, { vscode: second.vscode });
  await flushAsyncWork();

  assert.deepEqual(first.updates.slice(1), [
    { key: "gauge.recommendedSettings.options", value: "Remind me later", target: "global" },
  ]);
  assert.deepEqual(second.updates.slice(1), []);
  assert.equal(first.commands.some((entry) => entry.command === "workbench.action.reloadWindow"), false);
  assert.equal(second.commands.some((entry) => entry.command === "workbench.action.reloadWindow"), false);
});

test("ConfigProvider auto-applies recommended settings when Apply and Reload is already selected", async () => {
  const { ConfigProvider } = require("../src/config/configProvider");
  const {
    commands,
    informationPrompts,
    updates,
    vscode,
  } = createFakeVscode({
    inspected: needsRecommendedSettings("Apply & Reload"),
  });

  new ConfigProvider({ subscriptions: [] }, { vscode });
  await flushAsyncWork();

  assert.deepEqual(informationPrompts, []);
  assert.deepEqual(updates.slice(1), [
    { key: "files.autoSave", value: "afterDelay", target: "workspace" },
    { key: "files.autoSaveDelay", value: 500, target: "workspace" },
  ]);
  assert.deepEqual(commands.at(-1), { command: "workbench.action.reloadWindow" });
});
