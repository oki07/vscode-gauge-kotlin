"use strict";

const path = require("node:path");
const esbuild = require("esbuild");

const root = path.join(__dirname, "..");

esbuild.build({
  bundle: true,
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  entryPoints: [path.join(root, "src", "extension.js")],
  external: ["vscode"],
  format: "cjs",
  logLevel: "info",
  legalComments: "none",
  minify: true,
  outfile: path.join(root, "out", "extension.js"),
  platform: "node",
  target: "node16",
}).catch((error) => {
  process.exitCode = 1;
  throw error;
});
