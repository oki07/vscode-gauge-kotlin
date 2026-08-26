const assert = require("node:assert/strict");
const test = require("node:test");

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });
  return { promise, reject, resolve };
}

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

test("ConfigProvider keeps workspace settings untouched on activation", async () => {
  const { ConfigProvider } = require("../src/config/configProvider");
  const { commands, updates, vscode } = createFakeVscode();

  new ConfigProvider({ subscriptions: [] }, { vscode });
  await flushAsyncWork();

  const command = commands.find((entry) => entry.command === "gauge.config.saveRecommended");
  assert.ok(command);
  assert.deepEqual(updates, []);

  await command.handler();

  assert.deepEqual(updates, [
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
  assert.deepEqual(updates, [
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
  assert.deepEqual(updates, [
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

  assert.deepEqual(first.updates, [
    { key: "gauge.recommendedSettings.options", value: "Remind me later", target: "global" },
  ]);
  assert.deepEqual(second.updates, []);
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
  assert.deepEqual(updates, [
    { key: "files.autoSave", value: "afterDelay", target: "workspace" },
    { key: "files.autoSaveDelay", value: 500, target: "workspace" },
  ]);
  assert.deepEqual(commands.at(-1), { command: "workbench.action.reloadWindow" });
});

test("ConfigProvider ignores pending prompts and retained commands after disposal", async () => {
  const { ConfigProvider } = require("../src/config/configProvider");

  for (const outcome of ["Apply & Reload", "Ignore", "Remind me later", "reject"]) {
    const prompt = deferred();
    const promptContinuations = [];
    const fake = createFakeVscode({
      inspected: needsRecommendedSettings(undefined),
    });
    let commandDisposeCalls = 0;
    let disposalHandlerResult;
    fake.vscode.commands.registerCommand = (command, handler) => {
      fake.commands.push({ command, handler });
      return {
        dispose() {
          commandDisposeCalls += 1;
          disposalHandlerResult = handler();
        },
      };
    };
    fake.vscode.window.showInformationMessage = (message, ...actions) => {
      fake.informationPrompts.push({ message, actions });
      return {
        then(onFulfilled, onRejected) {
          const continuation = prompt.promise.then(onFulfilled, onRejected);
          continuation.catch(() => undefined);
          promptContinuations.push(continuation);
          return continuation;
        },
      };
    };
    const provider = new ConfigProvider({ subscriptions: [] }, { vscode: fake.vscode });
    const retainedHandler = fake.commands.find(
      (entry) => entry.command === "gauge.config.saveRecommended",
    ).handler;

    await Promise.resolve();
    provider.dispose();
    provider.dispose();
    if (outcome === "reject") {
      prompt.reject(new Error("disposed prompt failed"));
    } else {
      prompt.resolve(outcome);
    }
    const promptOutcome = await Promise.allSettled(promptContinuations);
    const disposalHandlerValue = await disposalHandlerResult;
    const retainedResult = await retainedHandler();
    const directResults = await Promise.all([
      provider.showRecommendedSettingsNotification(),
      provider.applySelectedOption("Apply & Reload"),
      provider.applyAndReload({ "files.autoSave": "afterDelay" }, "workspace"),
    ]);

    assert.deepEqual({
      commandDisposeCalls,
      directResults,
      disposalHandlerValue,
      informationPromptCount: fake.informationPrompts.length,
      outcome,
      promptOutcome,
      reloadCalls: fake.commands.filter(
        (entry) => entry.command === "workbench.action.reloadWindow",
      ).length,
      retainedResult,
      updates: fake.updates,
    }, {
      commandDisposeCalls: 1,
      directResults: [undefined, undefined, undefined],
      disposalHandlerValue: undefined,
      informationPromptCount: 1,
      outcome,
      promptOutcome: [{ status: "fulfilled", value: undefined }],
      reloadCalls: 0,
      retainedResult: undefined,
      updates: [],
    });
  }
});

test("ConfigProvider neutralizes settings updates that settle after disposal", async () => {
  const { ConfigProvider } = require("../src/config/configProvider");

  for (const outcome of ["resolve", "reject"]) {
    const updateGate = deferred();
    const updateEntered = deferred();
    const fake = createFakeVscode();
    const originalGetConfiguration = fake.vscode.workspace.getConfiguration;
    fake.vscode.workspace.getConfiguration = () => {
      const configuration = originalGetConfiguration();
      return {
        inspect: configuration.inspect,
        update(key, value, target) {
          fake.updates.push({ key, value, target });
          if (key === "files.autoSave") {
            updateEntered.resolve();
            return updateGate.promise;
          }
          return Promise.resolve(undefined);
        },
      };
    };
    const provider = new ConfigProvider({ subscriptions: [] }, { vscode: fake.vscode });
    const retainedHandler = fake.commands.find(
      (entry) => entry.command === "gauge.config.saveRecommended",
    ).handler;
    const pending = retainedHandler();

    await updateEntered.promise;
    provider.dispose();
    if (outcome === "resolve") {
      updateGate.resolve(undefined);
    } else {
      updateGate.reject(new Error("disposed update failed"));
    }
    const pendingOutcome = await Promise.allSettled([pending]);

    assert.deepEqual({
      outcome,
      pendingOutcome,
      reloadCalls: fake.commands.filter(
        (entry) => entry.command === "workbench.action.reloadWindow",
      ).length,
      updates: fake.updates,
    }, {
      outcome,
      pendingOutcome: [{ status: "fulfilled", value: undefined }],
      reloadCalls: 0,
      updates: [
        { key: "files.autoSave", value: "afterDelay", target: "workspace" },
        { key: "files.autoSaveDelay", value: 500, target: "workspace" },
      ],
    });
  }
});

test("ConfigProvider stops settings updates after synchronous disposal", async () => {
  const { ConfigProvider } = require("../src/config/configProvider");
  const fake = createFakeVscode();
  const originalGetConfiguration = fake.vscode.workspace.getConfiguration;
  let provider;
  fake.vscode.workspace.getConfiguration = () => {
    const configuration = originalGetConfiguration();
    return {
      inspect: configuration.inspect,
      update(key, value, target) {
        fake.updates.push({ key, value, target });
        if (key === "files.autoSave") {
          provider.dispose();
        }
        return Promise.resolve(undefined);
      },
    };
  };
  provider = new ConfigProvider({ subscriptions: [] }, { vscode: fake.vscode });
  const retainedHandler = fake.commands.find(
    (entry) => entry.command === "gauge.config.saveRecommended",
  ).handler;

  const result = await retainedHandler();

  assert.deepEqual({
    reloadCalls: fake.commands.filter(
      (entry) => entry.command === "workbench.action.reloadWindow",
    ).length,
    result,
    updates: fake.updates,
  }, {
    reloadCalls: 0,
    result: undefined,
    updates: [
      { key: "files.autoSave", value: "afterDelay", target: "workspace" },
    ],
  });
});

test("ConfigProvider suppresses constructor operation failures after disposal", async () => {
  const { ConfigProvider } = require("../src/config/configProvider");

  for (const boundaryName of ["auto-apply"]) {
    const updateGate = deferred();
    const updateEntered = deferred();
    const fake = createFakeVscode({
      inspected: needsRecommendedSettings("Apply & Reload"),
    });
    const originalGetConfiguration = fake.vscode.workspace.getConfiguration;
    fake.vscode.workspace.getConfiguration = () => {
      const configuration = originalGetConfiguration();
      return {
        inspect: configuration.inspect,
        update(key, value, target) {
          fake.updates.push({ key, value, target });
          if (key === "files.autoSave") {
            updateEntered.resolve();
            return updateGate.promise;
          }
          return Promise.resolve(undefined);
        },
      };
    };
    const provider = new ConfigProvider({ subscriptions: [] }, { vscode: fake.vscode });

    await updateEntered.promise;
    provider.dispose();
    updateGate.reject(new Error(`disposed ${boundaryName} update failed`));
    await flushAsyncWork();

    assert.deepEqual({
      boundaryName,
      reloadCalls: fake.commands.filter(
        (entry) => entry.command === "workbench.action.reloadWindow",
      ).length,
      updates: fake.updates.map(({ key }) => key),
    }, {
      boundaryName,
      reloadCalls: 0,
      updates: ["files.autoSave", "files.autoSaveDelay"],
    });
  }
});

test("ConfigProvider preserves live prompt update and reload failures", async () => {
  const { ConfigProvider } = require("../src/config/configProvider");
  const fake = createFakeVscode();
  const provider = new ConfigProvider({ subscriptions: [] }, { vscode: fake.vscode });
  Object.assign(fake.inspected, needsRecommendedSettings(undefined));
  fake.vscode.window.showInformationMessage = () => (
    Promise.reject(new Error("live prompt failed"))
  );

  await assert.rejects(
    provider.showRecommendedSettingsNotification(),
    /live prompt failed/,
  );

  const originalGetConfiguration = fake.vscode.workspace.getConfiguration;
  fake.vscode.workspace.getConfiguration = () => {
    const configuration = originalGetConfiguration();
    return {
      inspect: configuration.inspect,
      update() {
        return Promise.reject(new Error("live update failed"));
      },
    };
  };
  await assert.rejects(
    provider.applyAndReload({ key: "value" }, "workspace"),
    /live update failed/,
  );

  fake.vscode.workspace.getConfiguration = originalGetConfiguration;
  fake.vscode.commands.executeCommand = () => (
    Promise.reject(new Error("live reload failed"))
  );
  await assert.rejects(
    provider.applyAndReload({ key: "value" }, "workspace"),
    /live reload failed/,
  );
  provider.dispose();
});

test("ConfigProvider preserves concurrent live settings initiation", async () => {
  const { ConfigProvider } = require("../src/config/configProvider");
  const fake = createFakeVscode();
  const provider = new ConfigProvider({ subscriptions: [] }, { vscode: fake.vscode });
  const originalGetConfiguration = fake.vscode.workspace.getConfiguration;
  const updateGate = deferred();
  const updateCalls = [];
  fake.vscode.workspace.getConfiguration = () => {
    const configuration = originalGetConfiguration();
    return {
      inspect: configuration.inspect,
      update(key, value, target) {
        updateCalls.push({ key, target, value });
        return updateGate.promise;
      },
    };
  };

  const pending = provider.applySelectedOption("Apply & Reload");
  const callsBeforeSettlement = [...updateCalls];
  updateGate.resolve(undefined);
  await pending;

  assert.deepEqual(callsBeforeSettlement, [
    { key: "files.autoSave", value: "afterDelay", target: "workspace" },
    { key: "files.autoSaveDelay", value: 500, target: "workspace" },
    {
      key: "gauge.recommendedSettings.options",
      value: "Apply & Reload",
      target: "global",
    },
  ]);
  provider.dispose();
});

test("ConfigProvider neutralizes synchronous inspection and reload disposal", async () => {
  const { ConfigProvider } = require("../src/config/configProvider");
  const inspectFake = createFakeVscode();
  const originalInspectConfiguration = inspectFake.vscode.workspace.getConfiguration;
  let inspectProvider;
  let inspectArmed = false;
  inspectFake.vscode.workspace.getConfiguration = () => {
    const configuration = originalInspectConfiguration();
    return {
      inspect(key) {
        if (inspectArmed && key === "gauge.recommendedSettings.options") {
          inspectProvider.dispose();
        }
        return configuration.inspect(key);
      },
      update: configuration.update,
    };
  };
  inspectProvider = new ConfigProvider(
    { subscriptions: [] },
    { vscode: inspectFake.vscode },
  );
  Object.assign(inspectFake.inspected, needsRecommendedSettings(undefined));
  inspectArmed = true;

  const inspectResult = await inspectProvider.showRecommendedSettingsNotification();

  const reloadFake = createFakeVscode();
  let reloadProvider;
  reloadFake.vscode.commands.executeCommand = (command) => {
    reloadFake.commands.push({ command });
    reloadProvider.dispose();
    return Promise.reject(new Error("disposed reload failed"));
  };
  reloadProvider = new ConfigProvider(
    { subscriptions: [] },
    { vscode: reloadFake.vscode },
  );
  const reloadResult = await reloadProvider.applyAndReload(
    { key: "value" },
    "workspace",
  );

  assert.deepEqual({
    inspectPrompts: inspectFake.informationPrompts,
    inspectResult,
    reloadCalls: reloadFake.commands.filter(
      (entry) => entry.command === "workbench.action.reloadWindow",
    ).length,
    reloadResult,
  }, {
    inspectPrompts: [],
    inspectResult: undefined,
    reloadCalls: 1,
    reloadResult: undefined,
  });
});
