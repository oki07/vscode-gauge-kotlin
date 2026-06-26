"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
]);

function collectJavaScriptFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        files.push(...collectJavaScriptFiles(path.join(directory, entry.name)));
      }
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(path.join(directory, entry.name));
    }
  }

  return files;
}

const files = collectJavaScriptFiles(ROOT).sort();
let failed = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
}
