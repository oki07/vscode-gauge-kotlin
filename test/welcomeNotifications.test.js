const assert = require("node:assert/strict");
const test = require("node:test");

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function createWelcomeOperation() {
  const stopped = deferred();
  let current = true;
  return {
    options: {
      isCurrent() {
        return current;
      },
      stoppedSignal: stopped.promise,
    },
    stop() {
      current = false;
      stopped.resolve(undefined);
    },
  };
}

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

test("showWelcomeNotification closes pending choices with its activation", async () => {
  const { showWelcomeNotification } = require("../src/welcomeNotifications");

  for (const scenario of [
    { selection: "Learn more", settlement: "resolve" },
    { selection: "Do not show this again", settlement: "resolve" },
    { settlement: "reject" },
  ]) {
    const prompt = deferred();
    const operation = createWelcomeOperation();
    const { commands, updates, vscode } = createFakeVscode();
    const stateUpdates = [];
    vscode.window.showInformationMessage = () => prompt.promise;
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

    let outcome = { status: "pending" };
    const request = showWelcomeNotification(context, vscode, operation.options);
    const observed = Promise.resolve(request).then(
      (value) => {
        outcome = { status: "fulfilled", value };
      },
      (error) => {
        outcome = { error, status: "rejected" };
      },
    );
    operation.stop();
    await new Promise((resolve) => setImmediate(resolve));
    const terminalSnapshot = {
      commands: [...commands],
      outcome: { ...outcome },
      stateUpdates: [...stateUpdates],
      updates: [...updates],
    };

    if (scenario.settlement === "reject") {
      prompt.reject(new Error("late welcome prompt failed"));
    } else {
      prompt.resolve(scenario.selection);
    }
    await observed;
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(terminalSnapshot, {
      commands: [],
      outcome: { status: "fulfilled", value: undefined },
      stateUpdates: [{ key: "hasOpenedBefore", value: true }],
      updates: [],
    });
    assert.deepEqual(commands, []);
    assert.deepEqual(updates, []);
    assert.deepEqual(outcome, { status: "fulfilled", value: undefined });
  }
});

test("showWelcomeNotification detaches actions started before activation stops", async () => {
  const { showWelcomeNotification } = require("../src/welcomeNotifications");

  for (const selection of ["Learn more", "Do not show this again"]) {
    const actionEntered = deferred();
    const actionResponse = deferred();
    const operation = createWelcomeOperation();
    const { commands, updates, vscode } = createFakeVscode({ selection });
    const originalGetConfiguration = vscode.workspace.getConfiguration;
    vscode.commands.executeCommand = (command, ...args) => {
      commands.push({ command, args });
      actionEntered.resolve(undefined);
      return actionResponse.promise;
    };
    vscode.workspace.getConfiguration = (section) => {
      const configuration = originalGetConfiguration(section);
      if (section === "gauge.welcomeNotification") {
        return configuration;
      }
      return {
        ...configuration,
        update(key, value, target) {
          updates.push({ key, value, target });
          actionEntered.resolve(undefined);
          return actionResponse.promise;
        },
      };
    };
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

    let outcome = { status: "pending" };
    const request = showWelcomeNotification(context, vscode, operation.options);
    const observed = Promise.resolve(request).then(
      (value) => {
        outcome = { status: "fulfilled", value };
      },
      (error) => {
        outcome = { error, status: "rejected" };
      },
    );
    await actionEntered.promise;
    operation.stop();
    await new Promise((resolve) => setImmediate(resolve));
    const terminalOutcome = { ...outcome };

    actionResponse.reject(new Error("late welcome action failed"));
    await observed;
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(terminalOutcome, { status: "fulfilled", value: undefined });
    assert.deepEqual(outcome, { status: "fulfilled", value: undefined });
    assert.equal(commands.length + updates.length, 1);
  }
});

test("showWelcomeNotification closes pending first-run state updates with its activation", async () => {
  const { showWelcomeNotification } = require("../src/welcomeNotifications");
  const operation = createWelcomeOperation();
  const stateUpdate = deferred();
  const { vscode } = createFakeVscode();
  const context = {
    workspaceState: {
      get() {
        return false;
      },
      update() {
        return stateUpdate.promise;
      },
    },
  };

  let outcome = { status: "pending" };
  const request = showWelcomeNotification(context, vscode, operation.options);
  const observed = Promise.resolve(request).then(
    (value) => {
      outcome = { status: "fulfilled", value };
    },
    (error) => {
      outcome = { error, status: "rejected" };
    },
  );
  operation.stop();
  await new Promise((resolve) => setImmediate(resolve));
  const terminalOutcome = { ...outcome };

  stateUpdate.reject(new Error("late welcome state update failed"));
  await observed;
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(terminalOutcome, { status: "fulfilled", value: undefined });
  assert.deepEqual(outcome, { status: "fulfilled", value: undefined });
});

test("showWelcomeNotification neutralizes terminal entry and prompt reentrancy", async () => {
  const { showWelcomeNotification } = require("../src/welcomeNotifications");
  let dependencyCalls = 0;
  const stoppedBeforeEntry = createWelcomeOperation();
  stoppedBeforeEntry.stop();
  const stoppedResult = await showWelcomeNotification({
    workspaceState: {
      get() {
        dependencyCalls += 1;
        throw new Error("terminal welcome state read");
      },
    },
  }, {}, stoppedBeforeEntry.options);

  const promptOperation = createWelcomeOperation();
  const { commands, updates, vscode } = createFakeVscode();
  vscode.window.showInformationMessage = () => {
    promptOperation.stop();
    throw new Error("terminal welcome prompt failed");
  };
  const promptResult = await showWelcomeNotification({
    workspaceState: {
      get() {
        return false;
      },
      update() {
        return Promise.resolve(undefined);
      },
    },
  }, vscode, promptOperation.options);

  assert.equal(stoppedResult, undefined);
  assert.equal(promptResult, undefined);
  assert.equal(dependencyCalls, 0);
  assert.deepEqual(commands, []);
  assert.deepEqual(updates, []);
});

test("showWelcomeNotification reports state failures without waiting for the prompt", async () => {
  const { showWelcomeNotification } = require("../src/welcomeNotifications");
  const prompt = deferred();
  const stateError = new Error("welcome state update failed");
  const { vscode } = createFakeVscode();
  vscode.window.showInformationMessage = () => prompt.promise;
  const context = {
    workspaceState: {
      get() {
        return false;
      },
      update() {
        return Promise.reject(stateError);
      },
    },
  };

  let outcome = { status: "pending" };
  const request = showWelcomeNotification(context, vscode);
  const observed = Promise.resolve(request).then(
    (value) => {
      outcome = { status: "fulfilled", value };
    },
    (error) => {
      outcome = { error, status: "rejected" };
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  const beforePromptSettlement = { ...outcome };
  prompt.resolve(undefined);
  await observed;

  assert.deepEqual(beforePromptSettlement, { error: stateError, status: "rejected" });
  assert.deepEqual(outcome, { error: stateError, status: "rejected" });
});

test("showWelcomeNotification observes state updates before invoking the prompt", async () => {
  const { showWelcomeNotification } = require("../src/welcomeNotifications");
  const stateUpdate = deferred();
  const promptError = new Error("synchronous welcome prompt failed");
  let stateUpdateCatchCalls = 0;
  const originalCatch = stateUpdate.promise.catch;
  stateUpdate.promise.catch = function catchStateUpdate(...args) {
    stateUpdateCatchCalls += 1;
    return originalCatch.apply(this, args);
  };
  const { vscode } = createFakeVscode();
  vscode.window.showInformationMessage = () => {
    throw promptError;
  };
  const context = {
    workspaceState: {
      get() {
        return false;
      },
      update() {
        return stateUpdate.promise;
      },
    },
  };

  assert.throws(
    () => showWelcomeNotification(context, vscode),
    (error) => error === promptError,
  );
  const catchesBeforeCleanup = stateUpdateCatchCalls;
  originalCatch.call(stateUpdate.promise, () => undefined);
  stateUpdate.reject(new Error("abandoned welcome state update failed"));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(catchesBeforeCleanup, 1);
});

test("showWelcomeNotification preserves live workflow failures", async () => {
  const { showWelcomeNotification } = require("../src/welcomeNotifications");

  for (const boundary of ["state-update", "prompt", "action"]) {
    const expectedError = new Error(`live welcome ${boundary} failed`);
    const { vscode } = createFakeVscode({
      selection: boundary === "action" ? "Learn more" : undefined,
    });
    if (boundary === "prompt") {
      vscode.window.showInformationMessage = () => Promise.reject(expectedError);
    }
    if (boundary === "action") {
      vscode.commands.executeCommand = () => Promise.reject(expectedError);
    }
    const context = {
      workspaceState: {
        get() {
          return false;
        },
        update() {
          return boundary === "state-update"
            ? Promise.reject(expectedError)
            : Promise.resolve(undefined);
        },
      },
    };

    await assert.rejects(
      showWelcomeNotification(context, vscode),
      (error) => error === expectedError,
    );
  }

  for (const boundary of ["state-read", "state-update", "prompt"]) {
    const expectedError = new Error(`live synchronous welcome ${boundary} failed`);
    const { vscode } = createFakeVscode();
    if (boundary === "prompt") {
      vscode.window.showInformationMessage = () => {
        throw expectedError;
      };
    }
    const context = {
      workspaceState: {
        get() {
          if (boundary === "state-read") {
            throw expectedError;
          }
          return false;
        },
        update() {
          if (boundary === "state-update") {
            throw expectedError;
          }
          return Promise.resolve(undefined);
        },
      },
    };

    assert.throws(
      () => showWelcomeNotification(context, vscode),
      (error) => error === expectedError,
    );
  }
});

test("showInstallGaugeNotification reports the Gauge install instructions", async () => {
  const { showInstallGaugeNotification } = require("../src/welcomeNotifications");
  const { errors, vscode } = createFakeVscode();

  await showInstallGaugeNotification(vscode);

  assert.match(errors[0], /Gauge executable not found/);
  assert.match(errors[0], /installing-gauge/);
});

test("showUnsupportedGaugeVersionNotification reports the minimum Gauge version", async () => {
  const {
    showUnsupportedGaugeVersionNotification,
  } = require("../src/welcomeNotifications");
  const { errors, vscode } = createFakeVscode();

  await showUnsupportedGaugeVersionNotification(vscode, "0.9.6");

  assert.match(errors[0], /Unsupported Gauge Version/);
  assert.match(errors[0], /Gauge version >= 0\.9\.6/);
});
