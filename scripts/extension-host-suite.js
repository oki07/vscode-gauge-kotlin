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
  const projectRoot = realpathSync(folder.uri.fsPath);
  const uri = vscode.Uri.file(path.join(projectRoot, "specs", "example.spec"));
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

  await eventually("scenario folding range", () => vscode.commands.executeCommand(
    "vscode.executeFoldingRangeProvider", uri,
  ), (ranges) => ranges && ranges.some((range) => range.start === line - 2 && range.end === line + 1));

  const kotlinUri = vscode.Uri.file(path.join(
    projectRoot, "src", "test", "kotlin", "example", "StepImplementation.kt",
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

  for (const [label, sourceUri, position] of [
    ["spec", uri, new vscode.Position(line, 12)],
    ["Kotlin", kotlinUri, new vscode.Position(kotlinLine - 1, 15)],
    ["spec fresh argument", uri, new vscode.Position(line, 12)],
  ]) {
    const newName = label === "spec"
      ? 'Language vowels are "aeiou".' : "Language vowels are <vowelString>.";
    const edit = await eventually(`${label} rename edits`, () => vscode.commands.executeCommand(
      "vscode.executeDocumentRenameProvider", sourceUri, position, newName,
    ), (value) => value && value.size > 0);
    assert.ok(edit && edit.entries().some(([target]) => target.fsPath.endsWith("StepImplementation.kt")));
    assert.ok(edit.entries().some(([target, edits]) => target.fsPath.endsWith("example.spec") && edits.length === 2));
    const originals = new Map();
    for (const [target] of edit.entries()) {
      const source = await vscode.workspace.openTextDocument(target);
      originals.set(source, source.getText());
    }
    try {
      assert.ok(await vscode.workspace.applyEdit(edit));
      const argument = label === "spec fresh argument" ? "vowelString" : "aeiou";
      assert.equal(document.getText().split(`* Language vowels are "${argument}".`).length - 1, 2);
      assert.ok(kotlinDocument.getText().includes('@Step("Language vowels are <vowelString>.")'));
      process.stdout.write(`PASS ${label} applied step rename\n`);
    } finally {
      const restore = new vscode.WorkspaceEdit();
      for (const [source, text] of originals) {
        restore.replace(source.uri,
          new vscode.Range(source.positionAt(0), source.positionAt(source.getText().length)), text);
      }
      assert.ok(await vscode.workspace.applyEdit(restore));
    }
  }

  const beforeMissingStep = document.getText();
  try {
    const missing = new vscode.WorkspaceEdit();
    const missingLine = beforeMissingStep.split("\n").length - 1;
    missing.insert(uri, document.positionAt(beforeMissingStep.length), '* Missing editor step "hello"\n\n[Gauge](https://gauge.org)\n');
    assert.ok(await vscode.workspace.applyEdit(missing));
    await vscode.window.showTextDocument(document);
    await eventually("undefined step diagnostic", async () => vscode.languages.getDiagnostics(uri),
      (entries) => entries.some((entry) => entry.range.start.line === missingLine && /not defined|undefined|implementation.*not found/i.test(entry.message)));
    const actions = await eventually("undefined step quick fix", () => vscode.commands.executeCommand(
      "vscode.executeCodeActionProvider", uri, new vscode.Range(missingLine, 0, missingLine, 29), "quickfix",
    ), (entries) => entries && entries.some((entry) => entry.command && entry.command.command === "gauge.generate.step"));
    const action = actions.find((entry) => entry.command && entry.command.command === "gauge.generate.step");
    assert.match(action.command.arguments[0], /fun implementation/);
    assert.match(action.command.arguments[0], /@(?:com\.thoughtworks\.gauge\.)?Step/);
    process.stdout.write("PASS Kotlin quick fix payload\n");
    await eventually("specification web link", () => vscode.commands.executeCommand(
      "vscode.executeLinkProvider", uri, 20,
    ), (links) => links && links.some((link) => link.target
      && link.target.scheme === "https" && link.target.authority === "gauge.org"
      && link.range.start.line === missingLine + 2));
  } finally {
    const restore = new vscode.WorkspaceEdit();
    restore.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), beforeMissingStep);
    assert.ok(await vscode.workspace.applyEdit(restore));
  }
  await eventually("undefined diagnostic clears after removal", async () => vscode.languages.getDiagnostics(uri),
    (entries) => !entries.some((entry) => /not defined|undefined|implementation.*not found/i.test(entry.message)));

  // Gauge 1.6.35 CLI output, including table spacing, is recorded verbatim.
  const formatCase = require("../test/fixtures/format-parity.json").cases[0];
  const unformatted = formatCase.input;
  const formatted = formatCase.formatted;
  const originalSpec = document.getText();
  try {
    const input = new vscode.WorkspaceEdit();
    input.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(originalSpec.length)), unformatted);
    assert.ok(await vscode.workspace.applyEdit(input));
    await vscode.window.showTextDocument(document);
    const formatting = vscode.commands.executeCommand("gauge.format").then(() => true);
    await eventually("Gauge format command", () => formatting, Boolean);
    await eventually("Gauge format matches CLI", async () => document.getText(), (text) => text === formatted);
  } finally {
    const restore = new vscode.WorkspaceEdit();
    restore.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), originalSpec);
    assert.ok(await vscode.workspace.applyEdit(restore));
    assert.ok(await document.save(), "An edit immediately after formatting can be saved");
    process.stdout.write("PASS save after formatting\n");
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
    await vscode.commands.executeCommand("editor.action.commentLine");
    assert.equal(empty.getText(), "// <>", `${language} line comment`);
    await vscode.commands.executeCommand("editor.action.commentLine");
    assert.equal(empty.getText(), "<>", `${language} line comment toggle`);
    process.stdout.write(`PASS ${language} comment toggle\n`);
  }
}

module.exports = { run };
