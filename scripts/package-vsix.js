"use strict";

const { spawnSync } = require("node:child_process");
const { statSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const root = join(__dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const outputPath = join(tmpdir(), "vscode-gauge-kotlin-0.0.1.vsix");
const MAX_VSIX_FILES = 80;
const MAX_VSIX_BYTES = 1_000_000;
const MAX_BUNDLE_BYTES = 1_000_000;
const MAX_JAVASCRIPT_FILES = 2;

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

function archiveEntries(archivePath) {
  const yauzl = require("yauzl");
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (openError, archive) => {
      if (openError) {
        reject(openError);
        return;
      }
      const entries = [];
      archive.on("entry", (entry) => {
        if (!entry.fileName.endsWith("/")) {
          entries.push(entry.fileName);
        }
        archive.readEntry();
      });
      archive.on("end", () => resolve(entries));
      archive.on("error", reject);
      archive.readEntry();
    });
  });
}

function assertBudget(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function validatePackage() {
  const entries = await archiveEntries(outputPath);
  const javascriptEntries = entries.filter((entry) => entry.endsWith(".js"));
  const archiveBytes = statSync(outputPath).size;
  const bundleBytes = statSync(join(root, "out", "extension.js")).size;
  assertBudget(
    entries.includes("extension/out/extension.js"),
    "VSIX is missing extension/out/extension.js",
  );
  assertBudget(
    !entries.some((entry) => /^extension\/(?:src|node_modules)\//.test(entry)),
    "VSIX contains extension/src or extension/node_modules",
  );
  assertBudget(entries.length <= MAX_VSIX_FILES, `VSIX has ${entries.length} files`);
  assertBudget(archiveBytes <= MAX_VSIX_BYTES, `VSIX is ${archiveBytes} bytes`);
  assertBudget(bundleBytes <= MAX_BUNDLE_BYTES, `bundle is ${bundleBytes} bytes`);
  assertBudget(
    javascriptEntries.length <= MAX_JAVASCRIPT_FILES,
    `VSIX has ${javascriptEntries.length} JavaScript files`,
  );
  process.stdout.write([
    "VSIX production budget passed:",
    `  files: ${entries.length}/${MAX_VSIX_FILES}`,
    `  JavaScript files: ${javascriptEntries.length}/${MAX_JAVASCRIPT_FILES}`,
    `  bundle bytes: ${bundleBytes}/${MAX_BUNDLE_BYTES}`,
    `  VSIX bytes: ${archiveBytes}/${MAX_VSIX_BYTES}`,
    "",
  ].join("\n"));
}

// `npm ci` is what guarantees the tree packaged here matches the lockfile, and
// vsce keeps dependencies out of the VSIX with --no-dependencies, which
// validatePackage re-checks. Removing node_modules afterwards only left the
// checkout unable to run the gate again, because `npm run check` starts with a
// lint that needs its dev dependencies.
async function main() {
  run(npmCommand, ["ci", "--ignore-scripts"]);
  run(npmCommand, ["run", "bundle"]);
  run(npxCommand, [
    "--yes",
    "@vscode/vsce@3.9.1",
    "package",
    "--no-dependencies",
    "--out",
    outputPath,
  ]);
  await validatePackage();
}

main().catch((error) => {
  process.exitCode = 1;
  process.stderr.write(`${error.stack || error}\n`);
});
