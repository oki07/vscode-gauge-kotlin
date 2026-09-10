"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { realpathSync } = require("node:fs");
const vscode = require("vscode");

async function eventually(label, operation, accept) {
  const deadline = Date.now() + 45_000;
  let last;
  while (Date.now() < deadline) {
    let timer;
    try {
      last = await Promise.race([
        operation(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label}: request timed out`)), deadline - Date.now());
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (accept(last)) {
      process.stdout.write(`PASS ${label}\n`);
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label}: ${JSON.stringify(last)}`);
}

// VS Code's --extensionTestsPath loads this module inside the Extension Host.
// The workspace is an unmodified, compiled bundled Kotlin example project.
async function run() {
  const extension = vscode.extensions.getExtension("oki07.vscode-gauge-kotlin");
  assert.ok(extension, "Gauge Kotlin extension is installed");
  await extension.activate();
  assert.ok(extension.isActive);
  process.stdout.write(`PASS activation in VS Code ${vscode.version}, Node ${process.version}\n`);

  const commands = await vscode.commands.getCommands(true);
  for (const name of ["gauge.format", "gauge.preview", "gauge.execute.scenario", "gauge.specexplorer.runNode"]) {
    assert.ok(commands.includes(name), name);
  }
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  assert.ok(folder, "Open a bundled Kotlin example project as the workspace");
  const uri = vscode.Uri.file(path.join(folder.uri.fsPath, "specs", "example.spec"));
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
  assert.equal(document.languageId, "gauge");
  const line = document.getText().split("\n").findIndex((text) => text.startsWith("* Vowels"));
  assert.ok(line >= 0, "The workspace contains the bundled example specification");
  await eventually("Kotlin definition from spec", () => vscode.commands.executeCommand(
    "vscode.executeDefinitionProvider", uri, new vscode.Position(line, 12),
  ), (value) => value && value.some((entry) => (
    (entry.uri || entry.targetUri).fsPath.endsWith("StepImplementation.kt")
  )));
  await eventually("step completion", () => vscode.commands.executeCommand(
    "vscode.executeCompletionItemProvider", uri, new vscode.Position(line, 3),
  ), (value) => value && value.items.some((item) => (
    String(typeof item.label === "string" ? item.label : item.label.label).includes("Vowels")
  )));
  await eventually("specification symbols", () => vscode.commands.executeCommand(
    "vscode.executeDocumentSymbolProvider", uri,
  ), (value) => value && value.length > 0);
  await eventually("execution code lenses", () => vscode.commands.executeCommand(
    "vscode.executeCodeLensProvider", uri, 10,
  ), (value) => value && value.some((lens) => lens.command && /[Rr]un/.test(lens.command.title)));

  const kotlinUri = vscode.Uri.file(path.join(
    folder.uri.fsPath, "src", "test", "kotlin", "example", "StepImplementation.kt",
  ));
  const kotlinDocument = await vscode.workspace.openTextDocument(kotlinUri);
  const kotlinLine = kotlinDocument.getText().split("\n")
    .findIndex((text) => text.includes("fun setLanguageVowels"));
  assert.ok(kotlinLine >= 0, "The bundled Kotlin step implementation exists");
  for (const [label, sourceUri, position] of [
    ["spec", uri, new vscode.Position(line, 12)],
    ["Kotlin", kotlinUri, new vscode.Position(kotlinLine, 12)],
  ]) {
    await eventually(`${label} step references`, () => vscode.commands.executeCommand(
      "vscode.executeReferenceProvider", sourceUri, position,
    ), (value) => value && value.filter((entry) => realpathSync(entry.uri.fsPath) === realpathSync(uri.fsPath)).length === 2);
  }

  let runTimer;
  try {
    const result = await Promise.race([
      vscode.commands.executeCommand("gauge.execute.specification", uri),
      new Promise((_, reject) => {
        runTimer = setTimeout(() => reject(new Error("Gauge execution timed out")), 120_000);
      }),
    ]);
    assert.equal(result, true, "The bundled specification executes successfully");
    process.stdout.write("PASS specification execution\n");
  } finally {
    clearTimeout(runTimer);
  }

  for (const language of ["gauge", "gauge-concept"]) {
    const empty = await vscode.workspace.openTextDocument({ language, content: "" });
    await vscode.window.showTextDocument(empty);
    await vscode.commands.executeCommand("type", { text: "<" });
    assert.equal(empty.getText(), "<>", `${language} automatic argument pair`);
    process.stdout.write(`PASS ${language} automatic argument pair\n`);
  }
}

module.exports = { run };
