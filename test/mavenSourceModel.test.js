"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { MavenProject } = require("../src/project/mavenProject");

function model(root) {
  return { version: 1, projectRoot: root, languages: ["kotlin"], compilations: [{
    projectRoot: root, language: "kotlin", goal: "test-compile", executionId: "custom-tests",
    compilerVersion: "2.2.21", skipped: false, hasSources: true,
    sourcePaths: [path.join(root, "custom-tests")], additionalSourcePaths: [],
    configuredOutputDirectory: path.join(root, "target/test-classes"),
  }] };
}

async function fixture(t, transform = (value) => value, exitCode = 0) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "gauge maven model ")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, "maven");
  await fs.mkdir(path.join(home, "lib"), { recursive: true });
  await fs.writeFile(path.join(home, "lib/api.jar"), "");
  const calls = [];
  function processFor(action) {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(async () => {
      try { await action(child); } catch (error) { child.emit("error", error); }
    });
    return child;
  }
  const command = { spawn(args, options) {
    calls.push({ args, options });
    return processFor(async (child) => {
      if (args.includes("--version")) {
        child.stdout.emit("data", `Apache Maven 3.9.16\nMaven home: ${home}\nJava version: 21, runtime: ${root}\n`);
        child.emit("close", 0);
      } else {
        const output = args.find((arg) => arg.startsWith("-Dgauge.source.model.output=")).slice(28);
        const value = transform(model(root));
        if (value !== undefined) await fs.writeFile(output, JSON.stringify(value));
        child.stderr.emit("data", "Maven build output");
        child.emit("close", exitCode);
      }
    });
  } };
  const compilerCommand = { spawn() { return processFor((child) => child.emit("close", 0)); } };
  const project = new MavenProject(root, { Language: "java" });
  project.buildCommand = () => command;
  return { root, project, calls, options: { compilerCommand, temporaryDirectory: root } };
}

test("Maven compiler observation returns scoped metadata and cleans temporary files", async (t) => {
  const { root, project, calls, options } = await fixture(t);
  assert.deepEqual(await project.sourceModelAsync({}, options), { status: "available", ...model(root) });
  assert.ok(calls[1].args.includes("test-compile"));
  assert.equal(calls[1].options.cwd, root);
  assert.deepEqual(await fs.readdir(root), ["maven"]);
});

for (const [name, transform, exitCode] of [
  ["missing observation", () => undefined, 0],
  ["observer failure", (value) => ({ ...value, error: "Cannot inspect compiler" }), 0],
  ["failed build", (value) => value, 1],
  ["wrong root", (value) => ({ ...value, projectRoot: path.dirname(value.projectRoot) }), 0],
  ["unknown schema", (value) => ({ ...value, version: 2 }), 0],
  ["relative input", (value) => {
    value.compilations[0].sourcePaths = ["custom-tests"];
    return value;
  }, 0],
]) {
  test(`Maven compiler observation keeps ${name} unavailable`, async (t) => {
    const { root, project, options } = await fixture(t, transform, exitCode);
    const result = await project.sourceModelAsync({}, options);
    assert.equal(result.status, "unavailable");
    assert.equal(typeof result.reason, "string");
    assert.deepEqual(await fs.readdir(root), ["maven"]);
  });
}
