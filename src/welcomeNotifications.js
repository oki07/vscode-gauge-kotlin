"use strict";

const GAUGE_DOCS_URI = "https://docs.gauge.org";
const HAS_OPENED_BEFORE = "hasOpenedBefore";
const INSTALL_INSTRUCTION_URI = `${GAUGE_DOCS_URI}/getting_started/installing-gauge.html`;
const WELCOME_NOTIFICATION_CONFIG = "gauge.welcomeNotification";
const STOPPED_WELCOME_OPERATION = Symbol("stoppedWelcomeOperation");

function getVscode(vscode) {
  return vscode || require("vscode");
}

function shouldDisplayWelcomeNotification(context, vscode) {
  const openedBefore = context.workspaceState.get(HAS_OPENED_BEFORE);
  const showOn = vscode.workspace
    .getConfiguration(WELCOME_NOTIFICATION_CONFIG)
    .get("showOn");
  return showOn !== "never" && !openedBefore;
}

function welcomeOperationCurrent(options) {
  return !options || typeof options.isCurrent !== "function" || options.isCurrent();
}

function waitForWelcomeOperation(value, options) {
  const observed = Promise.resolve(value);
  if (!options || !options.stoppedSignal) {
    return observed;
  }
  return Promise.race([
    observed,
    Promise.resolve(options.stoppedSignal).then(() => STOPPED_WELCOME_OPERATION),
  ]);
}

function invokeForWelcomeOperation(options, callback) {
  if (!welcomeOperationCurrent(options)) {
    return Promise.resolve(STOPPED_WELCOME_OPERATION);
  }
  let value;
  try {
    value = callback();
  } catch (error) {
    if (!welcomeOperationCurrent(options)) {
      return Promise.resolve(STOPPED_WELCOME_OPERATION);
    }
    throw error;
  }
  if (!welcomeOperationCurrent(options)) {
    Promise.resolve(value).catch(() => undefined);
    return Promise.resolve(STOPPED_WELCOME_OPERATION);
  }
  return waitForWelcomeOperation(value, options);
}

function showWelcomeNotification(context, vscodeApi, options = {}) {
  if (!welcomeOperationCurrent(options)) {
    return Promise.resolve(undefined);
  }
  const vscode = getVscode(vscodeApi);
  let display;
  try {
    display = shouldDisplayWelcomeNotification(context, vscode);
  } catch (error) {
    if (!welcomeOperationCurrent(options)) {
      return Promise.resolve(undefined);
    }
    throw error;
  }
  if (!welcomeOperationCurrent(options)) {
    return Promise.resolve(undefined);
  }
  const stateUpdate = invokeForWelcomeOperation(
    options,
    () => context.workspaceState.update(HAS_OPENED_BEFORE, true),
  );
  stateUpdate.catch(() => undefined);
  if (!display) {
    return stateUpdate.then(() => undefined);
  }
  const selection = invokeForWelcomeOperation(options, () => (
    vscode.window.showInformationMessage(
      "Gauge plugin initialised.",
      "Learn more",
      "Do not show this again",
    )
  ));
  const action = selection.then((option) => {
    if (option === STOPPED_WELCOME_OPERATION || !welcomeOperationCurrent(options)) {
      return STOPPED_WELCOME_OPERATION;
    }
    if (option === "Learn more") {
      return invokeForWelcomeOperation(
        options,
        () => vscode.commands.executeCommand("vscode.open", vscode.Uri.parse(GAUGE_DOCS_URI)),
      );
    }
    if (option === "Do not show this again") {
      return invokeForWelcomeOperation(
        options,
        () => vscode.workspace.getConfiguration().update(
          `${WELCOME_NOTIFICATION_CONFIG}.showOn`,
          "never",
          true,
        ),
      );
    }
    return undefined;
  });
  return Promise.all([stateUpdate, action]).then(() => undefined);
}

function showInstallGaugeNotification(vscodeApi) {
  const vscode = getVscode(vscodeApi);
  return vscode.window.showErrorMessage(
    `Gauge executable not found!\n[Click here](${INSTALL_INSTRUCTION_URI}) for install instructions.`,
  );
}

function showUnsupportedGaugeVersionNotification(vscodeApi, minimumVersion) {
  const vscode = getVscode(vscodeApi);
  return vscode.window.showErrorMessage(
    `Unsupported Gauge Version\nThis version of Gauge Kotlin only works with Gauge version >= ${minimumVersion}`,
  );
}

module.exports = {
  showInstallGaugeNotification,
  showUnsupportedGaugeVersionNotification,
  showWelcomeNotification,
};
