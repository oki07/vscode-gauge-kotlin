"use strict";

const { spawnSync } = require("node:child_process");
const { rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const root = join(__dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const outputPath = join(tmpdir(), "vscode-gauge-kotlin-0.0.1.vsix");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

try {
  run(npmCommand, ["ci", "--omit=dev", "--ignore-scripts"]);
  run(npxCommand, [
    "--yes",
    "@vscode/vsce@3.9.1",
    "package",
    "--out",
    outputPath,
  ]);
} finally {
  rmSync(join(root, "node_modules"), { force: true, recursive: true });
}
