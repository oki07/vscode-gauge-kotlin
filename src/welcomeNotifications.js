"use strict";

const GAUGE_DOCS_URI = "https://docs.gauge.org";
const HAS_OPENED_BEFORE = "hasOpenedBefore";
const INSTALL_INSTRUCTION_URI = `${GAUGE_DOCS_URI}/getting_started/installing-gauge.html`;
const WELCOME_NOTIFICATION_CONFIG = "gauge.welcomeNotification";

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

function showWelcomeNotification(context, vscodeApi) {
  const vscode = getVscode(vscodeApi);
  const display = shouldDisplayWelcomeNotification(context, vscode);
  const stateUpdate = context.workspaceState.update(HAS_OPENED_BEFORE, true);
  if (!display) {
    return stateUpdate;
  }
  return vscode.window.showInformationMessage(
    "Gauge plugin initialised.",
    "Learn more",
    "Do not show this again",
  ).then((option) => {
    if (option === "Learn more") {
      return vscode.commands.executeCommand("vscode.open", vscode.Uri.parse(GAUGE_DOCS_URI));
    }
    if (option === "Do not show this again") {
      return vscode.workspace.getConfiguration().update(
        `${WELCOME_NOTIFICATION_CONFIG}.showOn`,
        "never",
        true,
      );
    }
    return undefined;
  }).then(() => stateUpdate);
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
