const assert = require("node:assert/strict");
const test = require("node:test");

function createFakeVscode(overrides = {}) {
  const commands = [];
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
      showInformationMessage() {
        return Promise.resolve(undefined);
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
            inspected[key] = { workspaceValue: value };
            return Promise.resolve(undefined);
          },
        };
      },
    },
  };
  return { commands, updates, vscode };
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
