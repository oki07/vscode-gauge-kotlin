"use strict";

// Diagnose "Go to Definition" from a Gauge step (in a .spec or .cpt file) to its
// Kotlin @Step implementation, by running the real GaugeStepDefinitionProvider
// against the files on disk with a realistic VS Code shim.
//
// This deliberately opens .kt files with languageId "plaintext" to reproduce the
// common case where no separate Kotlin language extension is installed (VS Code
// ships none), which is when navigation used to silently fail.
//
// Usage:
//   node scripts/diagnose-definition.js <projectRoot> <relSpecOrCptPath> <lineNumber>
//
// Example:
//   node scripts/diagnose-definition.js . specs/concepts/login.cpt 3

const fs = require("node:fs");
const path = require("node:path");

const { GaugeStepDefinitionProvider, stepTextAt } = require("../src/stepDefinitionProvider");
const { createProjectFactory } = require("../src/project/projectFactory");

const IGNORED_DIRS = new Set(["node_modules", ".git", "build", ".gradle", "out", "dist"]);

function languageIdFor(file) {
  if (file.endsWith(".cpt") || file.endsWith(".spec")) {
    return "gauge";
  }
  // Simulate "no Kotlin extension installed": .kt opens as plaintext.
  return "plaintext";
}

function makeUri(file) {
  return { fsPath: file, scheme: "file", path: file, toString: () => `file://${file}` };
}

function makeDocument(file) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  return {
    languageId: languageIdFor(file),
    lineCount: lines.length,
    uri: makeUri(file),
    getText: () => text,
    lineAt: (line) => ({ text: lines[line] || "" }),
  };
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_error) {
    return out;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function makeVscode(root) {
  class Position {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  }
  class Range {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  }
  class Location {
    constructor(uri, range) {
      this.uri = uri;
      this.range = range;
    }
  }
  return {
    Position,
    Range,
    Location,
    Uri: { file: makeUri },
    languages: { registerDefinitionProvider: () => ({ dispose() {} }) },
    workspace: {
      textDocuments: [],
      async findFiles() {
        return walk(root).filter((file) => file.endsWith(".kt")).map(makeUri);
      },
      async openTextDocument(uri) {
        return makeDocument(uri.fsPath || uri);
      },
    },
  };
}

async function main() {
  const [, , rootArg, relTarget, lineArg] = process.argv;
  if (!rootArg || !relTarget || !lineArg) {
    console.error("Usage: node scripts/diagnose-definition.js <projectRoot> <relSpecOrCptPath> <lineNumber>");
    process.exit(2);
  }
  const root = path.resolve(rootArg);
  const targetFile = path.join(root, relTarget);
  const lineNo = Number(lineArg);
  const line = lineNo - 1;

  const vscode = makeVscode(root);
  const projectFactory = createProjectFactory({ fileSystem: fs, pathModule: path, vscode });
  const provider = new GaugeStepDefinitionProvider({ projectFactory, vscode });
  const document = makeDocument(targetFile);

  console.log(`project root : ${root}`);
  console.log(`target file  : ${relTarget} (line ${lineNo})`);
  console.log(`languageId   : ${document.languageId}`);
  console.log(`line text    : ${JSON.stringify(document.lineAt(line).text)}`);
  console.log(`step text    : ${JSON.stringify(stepTextAt(document, new vscode.Position(line, 2)))}`);
  console.log(`gauge project: ${provider.isGaugeProjectDocument(document)}`);

  const results = await provider.provideDefinition(document, new vscode.Position(line, 2));
  console.log(`definitions  : ${Array.isArray(results) ? results.length : 0}`);
  for (const location of results || []) {
    console.log(`  -> ${location.uri.fsPath} @ line ${location.range.start.line + 1}`);
  }
  if (!results || results.length === 0) {
    console.log("\nNo implementation found. Check that the .kt file with the matching");
    console.log("@Step annotation is inside this project root and not under an ignored");
    console.log(`directory (${[...IGNORED_DIRS].join(", ")}).`);
  }
}

main().catch((error) => {
  console.error("ERROR:", error);
  process.exit(1);
});
