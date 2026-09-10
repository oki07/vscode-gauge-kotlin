"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

async function within(operation) {
  let timer;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Concept verification timed out")), 120000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function eventually(label, operation, accept) {
  const end = Date.now() + 30000;
  do {
    const value = await within(operation);
    if (accept(value)) {
      process.stdout.write(`PASS ${label}\n`);
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  } while (Date.now() < end);
  throw new Error(label);
}

async function replaceDocument(document, text) {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
  assert.ok(await vscode.workspace.applyEdit(edit));
  assert.ok(await document.save());
}

// The workspace must be a disposable, compiled bundled Maven example.
async function run() {
  await within(() => vscode.extensions.getExtension("oki07.vscode-gauge-kotlin").activate());
  const root = fs.realpathSync(vscode.workspace.workspaceFolders[0].uri.fsPath);
  const specUri = vscode.Uri.file(path.join(root, "specs/example.spec"));
  const conceptUri = vscode.Uri.file(path.join(root, "concepts/editor-host.cpt"));
  assert.equal(fs.existsSync(conceptUri.fsPath), false, "The concept fixture path is unused");
  const spec = await vscode.workspace.openTextDocument(specUri);
  const original = spec.getText();
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(conceptUri.fsPath)));
  try {
    await vscode.workspace.fs.writeFile(conceptUri, Buffer.from([
      "# Initialize vowels <letters>", "", "* Vowels in English language are <letters>.", "",
      "# Wrapped vowels <letters> <mode>", "", "* Initialize vowels <letters>", "",
    ].join("\n")));
    const concept = await vscode.workspace.openTextDocument(conceptUri);
    await replaceDocument(spec, [
      "# Concept integration", "", "## Usage", "", '* Initialize vowels "aeiou"',
      '* Wrapped vowels "aeiou" "fast"', '* The word "gauge" has "3" vowels.', "",
    ].join("\n"));
    await vscode.window.showTextDocument(spec);
    await eventually("concept definition", () => vscode.commands.executeCommand(
      "vscode.executeDefinitionProvider", specUri, new vscode.Position(4, 10),
    ), (entries) => entries && entries.some((entry) => (entry.uri || entry.targetUri).fsPath.endsWith("editor-host.cpt")));
    await eventually("concept leaf Kotlin definition", () => vscode.commands.executeCommand(
      "vscode.executeDefinitionProvider", conceptUri, new vscode.Position(2, 10),
    ), (entries) => entries && entries.some((entry) => (entry.uri || entry.targetUri).fsPath.endsWith("StepImplementation.kt")));
    for (const newName of ["Prepare vowels <letters>", "Prepare vowels <letters> via <mode>"]) {
      const edit = await within(() => vscode.commands.executeCommand(
        "vscode.executeDocumentRenameProvider", conceptUri, new vscode.Position(0, 10), newName,
      ));
      assert.ok(edit && edit.size > 0);
      assert.ok(await vscode.workspace.applyEdit(edit));
      assert.ok(await spec.save());
      assert.ok(await concept.save());
    }
    assert.ok(spec.getText().includes('* Prepare vowels "aeiou" via "mode"'));
    assert.ok(concept.getText().includes("# Prepare vowels <letters> via <mode>"));
    assert.ok(concept.getText().includes("* Prepare vowels <letters> via <mode>"));
    process.stdout.write("PASS concept heading and contextual usage rename\n");
    const result = await within(() => vscode.commands.executeCommand("gauge.execute.specification", specUri));
    assert.equal(result, true, "The renamed direct and nested concept calls execute");
    process.stdout.write(`PASS renamed concept execution in VS Code ${vscode.version}\n`);
  } finally {
    await replaceDocument(spec, original);
    await vscode.workspace.fs.delete(conceptUri);
  }
}

module.exports = { run };
