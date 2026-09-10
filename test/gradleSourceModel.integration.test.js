"use strict";

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const test = require("node:test");
const { Command } = require("../src/cli");
const { GradleProject } = require("../src/project/gradleProject");
const expected = require("./fixtures/gradle-source-model/expected.json");

async function classFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await classFiles(path.join(directory, entry.name), relative + "/"));
    else if (entry.name.endsWith(".class")) files.push(relative);
  }
  return files.sort();
}

// Gradle 8.10 / Kotlin 2.2.21 compiler output distinguishes source-set inputs,
// excluded files, unattached files, and files created by a generation task.
test("Gradle source model reports compiler source collections and additional arguments", {
  skip: !process.env.GAUGE_LIFECYCLE_GRADLE,
  timeout: 180000,
}, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "gauge source integration "));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.cp(path.join(__dirname, "fixtures/gradle-source-model"), directory, { recursive: true });
  const root = await fs.realpath(directory);
  const project = new GradleProject(root, { Language: "java" });
  project.getBuildCommand = () => new Command(process.env.GAUGE_LIFECYCLE_GRADLE);
  async function inputs() {
    const model = await project.sourceModelAsync({});
    assert.equal(model.status, "available", model.reason);
    return [...new Set(model.compilations.flatMap((compilation) => compilation.sourceFiles))]
      .map((file) => path.relative(root, file).split(path.sep).join("/")).sort();
  }
  assert.deepEqual(await inputs(), expected.beforeGeneration);
  await assert.rejects(fs.access(path.join(root, expected.generatedSource)));
  await promisify(execFile)(process.env.GAUGE_LIFECYCLE_GRADLE, ["-q", "--console=plain", "testClasses"], {
    cwd: root, timeout: 120000,
  });
  const after = [...expected.beforeGeneration, expected.generatedSource].sort();
  assert.deepEqual(await inputs(), after);
  assert.deepEqual(await classFiles(path.join(root, "build/classes")), expected.compiledClasses);
  const added = "custom-tests/Added.kt";
  await fs.writeFile(path.join(root, added), "class Added\n");
  assert.deepEqual(await inputs(), [...after, added].sort());
  await fs.unlink(path.join(root, added));
  assert.deepEqual(await inputs(), after);
  await fs.appendFile(path.join(root, "build.gradle.kts"), `
tasks.named<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>("compileTestKotlin") {
    compilerOptions.freeCompilerArgs.add(file("notes/Scratch.kt").absolutePath)
}
`);
  const withArguments = await project.sourceModelAsync({});
  assert.equal(withArguments.status, "available", withArguments.reason);
  const testCompiler = withArguments.compilations.find((compilation) => compilation.task === ":compileTestKotlin");
  assert.ok(!testCompiler.sourceFiles.includes(path.join(root, expected.additionalSource)));
  assert.deepEqual(testCompiler.additionalArguments, [path.join(root, expected.additionalSource)]);
  await promisify(execFile)(process.env.GAUGE_LIFECYCLE_GRADLE, ["-q", "--console=plain", "testClasses"], {
    cwd: root, timeout: 120000,
  });
  assert.deepEqual(await classFiles(path.join(root, "build/classes")), [
    ...expected.compiledClasses, expected.additionalClass,
  ].sort());
});
