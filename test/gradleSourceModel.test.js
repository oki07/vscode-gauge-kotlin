"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { GradleProject } = require("../src/project/gradleProject");

async function fixture(t, response, exitCode = 0) {
  const root = fs.realpathSync(await fs.promises.mkdtemp(path.join(os.tmpdir(), "gauge source model ")));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const project = new GradleProject(root, { Language: "java" });
  const calls = [];
  project.getBuildCommand = () => ({
    spawn(args, options) {
      calls.push({ args, options });
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        const output = args.find((arg) => arg.startsWith("-PgaugeSourceModelOutput=")).split("=").slice(1).join("=");
        if (response !== undefined) fs.writeFileSync(output, response(root));
        child.stderr.emit("data", Buffer.from("build output"));
        child.emit("close", exitCode);
      });
      return child;
    },
  });
  return { root, project, calls };
}

function model(root) {
  return {
    version: 1,
    projectRoot: root,
    compilations: [{
      task: ":compileTestKotlin",
      language: "kotlin",
      sourceFiles: [path.join(root, "custom-tests/Custom.kt")],
      javaSourceFiles: [path.join(root, "src/test/java/JavaStep.java")],
      additionalArguments: [],
      outputDirectory: path.join(root, "build/classes/kotlin/test"),
    }],
  };
}

test("Gradle source model returns compiler inputs and removes temporary query files", async (t) => {
  const { root, project, calls } = await fixture(t, (directory) => JSON.stringify(model(directory)));
  const result = await project.sourceModelAsync({}, { temporaryDirectory: root });
  assert.deepEqual(result, { status: "available", ...model(root) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.cwd, root);
  assert.ok(calls[0].args.includes("--no-configuration-cache"));
  assert.ok(!calls[0].args.includes("testClasses"), "the query must not execute compilation");
  assert.deepEqual(await fs.promises.readdir(root), []);
});

for (const [name, response, exitCode] of [
  ["failed build", (root) => JSON.stringify(model(root)), 1],
  ["missing output", undefined, 0],
  ["malformed output", () => "not json", 0],
  ["unsupported schema", (root) => JSON.stringify({ ...model(root), version: 2 }), 0],
  ["different project", (root) => JSON.stringify({ ...model(root), projectRoot: path.dirname(root) }), 0],
  ["relative source", (root) => {
    const value = model(root);
    value.compilations[0].sourceFiles = ["relative.kt"];
    return JSON.stringify(value);
  }, 0],
  ["invalid compiler arguments", (root) => {
    const value = model(root);
    value.compilations[0].additionalArguments = [null];
    return JSON.stringify(value);
  }, 0],
]) {
  test(`Gradle source model keeps ${name} distinct from an empty source set`, async (t) => {
    const { root, project } = await fixture(t, response, exitCode);
    const result = await project.sourceModelAsync({}, { temporaryDirectory: root });
    assert.equal(result.status, "unavailable");
    assert.equal(typeof result.reason, "string");
    assert.equal(result.compilations, undefined);
    assert.deepEqual(await fs.promises.readdir(root), []);
  });
}

test("Gradle source model accepts an empty compiler source collection", async (t) => {
  const { root, project } = await fixture(t, (directory) => {
    const value = model(directory);
    value.compilations[0].sourceFiles = [];
    value.compilations[0].javaSourceFiles = [];
    return JSON.stringify(value);
  });
  const result = await project.sourceModelAsync({}, { temporaryDirectory: root });
  assert.equal(result.status, "available");
  assert.deepEqual(result.compilations[0].sourceFiles, []);
});
