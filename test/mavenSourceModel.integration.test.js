"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { Command } = require("../src/cli");
const { MavenProject } = require("../src/project/mavenProject");
const corpus = require("./fixtures/maven-source-model.json");

async function files(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(file));
    else result.push(file);
  }
  return result;
}

// Maven 3.9.16 / Kotlin 2.2.21 compilation distinguishes configured sourceDirs,
// primary-root emptiness, compiler arguments, skip state, and execution IDs.
test("Maven observation agrees with actual Kotlin class output across configured executions", {
  skip: !process.env.GAUGE_SOURCE_MAVEN, timeout: 600000,
}, async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "gauge maven integration "));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  for (const item of corpus) {
    await t.test(item.name, async () => {
      const directory = path.join(base, item.name);
      await fs.mkdir(directory);
      const root = await fs.realpath(directory);
      await fs.writeFile(path.join(root, "pom.xml"), item.pom);
      for (const [relative, name] of [
        ["src/main/kotlin/Main.kt", "Main"], ["src/test/kotlin/Default.kt", "Default"],
        ["custom-tests/Custom.kt", "Custom"], ["notes/Scratch.kt", "Scratch"],
      ]) {
        const file = path.join(root, relative);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, `class ${name}\n`);
      }
      await fs.writeFile(path.join(root, "arguments.txt"), `-jvm-target\n17\n${JSON.stringify(item.relativeArgumentContent ? "notes/Scratch.kt" : path.join(root, "notes/Scratch.kt"))}\n`);
      const project = new MavenProject(root, { Language: "java" });
      project.buildCommand = () => new Command(process.env.GAUGE_SOURCE_MAVEN);
      const result = await project.sourceModelAsync({});
      const classes = (await files(path.join(root, "target"))).filter((file) => file.endsWith(".class"))
        .map((file) => path.relative(path.join(root, "target"), file).split(path.sep).join("/")).sort();
      assert.deepEqual(classes, item.classes);
      if (item.unavailable) {
        assert.equal(result.status, "unavailable");
        assert.ok(result.reason.includes(item.unavailable), result.reason);
        return;
      }
      assert.equal(result.status, "available", result.reason);
      assert.deepEqual(result.languages, ["kotlin"]);
      assert.deepEqual(result.compilations.map((entry) => entry.executionId), item.executionIds);
      const observed = new Set();
      for (const compilation of result.compilations) {
        assert.equal(compilation.skipped, item.name === "skip-tests");
        if (compilation.skipped || !compilation.hasSources) continue;
        for (const input of [...compilation.sourcePaths, ...compilation.additionalSourcePaths]) {
          const stat = await fs.stat(input).catch(() => undefined);
          const entries = stat?.isDirectory() ? await files(input) : stat?.isFile() ? [input] : [];
          for (const source of entries.filter((file) => file.endsWith(".kt"))) {
            observed.add(path.relative(path.join(root, "target"), path.join(compilation.configuredOutputDirectory,
              path.basename(source, ".kt") + ".class")).split(path.sep).join("/"));
          }
        }
      }
      assert.deepEqual([...observed].sort(), item.classes);
    });
  }
});
