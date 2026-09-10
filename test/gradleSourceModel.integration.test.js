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

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "gauge source integration "));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.cp(path.join(__dirname, "fixtures/gradle-source-model"), directory, { recursive: true });
  const root = await fs.realpath(directory);
  const project = new GradleProject(root, { Language: "java" });
  project.getBuildCommand = () => new Command(process.env.GAUGE_LIFECYCLE_GRADLE);
  return { root, project };
}

function build(root, ...tasks) {
  return promisify(execFile)(process.env.GAUGE_LIFECYCLE_GRADLE, ["-q", "--console=plain", ...tasks], {
    cwd: root, timeout: 120000,
  });
}

// Gradle 8.10 / Kotlin 2.2.21 compiler output distinguishes source-set inputs,
// excluded files, unattached files, and files created by a generation task.
test("Gradle source model reports compiler source collections and additional arguments", {
  skip: !process.env.GAUGE_LIFECYCLE_GRADLE,
  timeout: 180000,
}, async (t) => {
  const { root, project } = await fixture(t);
  async function inputs() {
    const model = await project.sourceModelAsync({});
    assert.equal(model.status, "available", model.reason);
    return [...new Set(model.compilations.flatMap((compilation) => compilation.sourceFiles))]
      .map((file) => path.relative(root, file).split(path.sep).join("/")).sort();
  }
  assert.deepEqual(await inputs(), expected.beforeGeneration);
  await assert.rejects(fs.access(path.join(root, expected.generatedSource)));
  await build(root, "testClasses");
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
  assert.deepEqual(testCompiler.additionalSourcePaths, [path.join(root, expected.additionalSource)]);
  await build(root, "testClasses");
  assert.deepEqual(await classFiles(path.join(root, "build/classes")), [
    ...expected.compiledClasses, expected.additionalClass,
  ].sort());
});

for (const relativeArgfile of [false, true]) {
  test(`Gradle source model parses DAEMON quoted sources in ${relativeArgfile ? "a relative" : "an absolute"} argfile`, {
    skip: !process.env.GAUGE_LIFECYCLE_GRADLE,
    timeout: 180000,
  }, async (t) => {
    const { root, project } = await fixture(t);
    await fs.appendFile(path.join(root, "build.gradle.kts"), `
tasks.named<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>("compileTestKotlin") {
  compilerExecutionStrategy.set(org.jetbrains.kotlin.gradle.tasks.KotlinCompilerExecutionStrategy.DAEMON)
  useDaemonFallbackStrategy.set(false)
  val params = javaClass.classLoader.loadClass("org.jetbrains.kotlin.daemon.common.DaemonParamsKt")
  val options = params.getMethod("configureDaemonOptions").invoke(null)
  val base = File(options.javaClass.getMethod("getRunFilesPath").invoke(options) as String).canonicalFile
  val relativeSource = base.toPath().relativize(file("notes/Scratch.kt").canonicalFile.toPath()).toString()
  val argfile = file("source arguments.txt").canonicalFile
  argfile.writeText("-module-name\\n${expected.argumentModuleName}\\n" +
      groovy.json.JsonOutput.toJson(relativeSource) + "\\n")
  val operand = if (${relativeArgfile}) base.toPath().relativize(argfile.toPath()).toString() else argfile.path
  compilerOptions.freeCompilerArgs.set(listOf("@" + operand))
}
`);
    // Gradle 8.10 / Kotlin 2.2.21 class output proves that compiler-relative
    // operands in quoted argfiles are sources; a module name ending in .kt is not.
    await build(root, "testClasses");
    assert.deepEqual(await classFiles(path.join(root, "build/classes")), [
      ...expected.compiledClasses, expected.additionalClass,
    ].sort());
    const model = await project.sourceModelAsync({});
    assert.equal(model.status, "available", model.reason);
    const compiler = model.compilations.find((entry) => entry.task === ":compileTestKotlin");
    assert.deepEqual(compiler.additionalSourcePaths, [path.join(root, expected.additionalSource)]);
    if (relativeArgfile) {
      await fs.appendFile(path.join(root, "build.gradle.kts"), `
tasks.named<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>("compileTestKotlin") {
  useDaemonFallbackStrategy.set(true)
}
`);
      const fallback = await project.sourceModelAsync({});
      assert.equal(fallback.status, "unavailable");
      assert.match(fallback.reason, /Relative Kotlin arguments require a fixed compiler working directory/);
      for (const argument of ["-Duser.dir", "-Duser.dir=/tmp/gauge-source-model"]) {
        await fs.appendFile(path.join(root, "build.gradle.kts"), `
tasks.named<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>("compileTestKotlin") {
    useDaemonFallbackStrategy.set(false)
    kotlinDaemonJvmArguments.set(listOf("${argument}"))
}
`);
        const overriddenDirectory = await project.sourceModelAsync({});
        assert.equal(overriddenDirectory.status, "unavailable");
        assert.match(overriddenDirectory.reason, /Relative Kotlin arguments require a fixed compiler working directory/);
      }
      const command = project.getBuildCommand();
      project.getBuildCommand = () => ({
        spawn(args, options) {
          return command.spawn(["-Dkotlin.daemon.options=runFilesPath=relative-daemon", ...args], options);
        },
      });
      await fs.appendFile(path.join(root, "build.gradle.kts"), `
tasks.named<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>("compileTestKotlin") {
    kotlinDaemonJvmArguments.set(emptyList())
}
`);
      const relativeDirectory = await project.sourceModelAsync({});
      assert.equal(relativeDirectory.status, "unavailable");
      assert.match(relativeDirectory.reason, /Relative Kotlin arguments require a fixed compiler working directory/);
    }
  });
}

test("Gradle source model parses absolute in-process inputs and keeps relative inputs unavailable", {
  skip: !process.env.GAUGE_LIFECYCLE_GRADLE,
  timeout: 180000,
}, async (t) => {
  const { root, project } = await fixture(t);
  await fs.appendFile(path.join(root, "build.gradle.kts"), `
tasks.named<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>("compileTestKotlin") {
    compilerExecutionStrategy.set(org.jetbrains.kotlin.gradle.tasks.KotlinCompilerExecutionStrategy.IN_PROCESS)
    val argfile = file("source arguments.txt")
    argfile.writeText(groovy.json.JsonOutput.toJson(file("notes/Scratch.kt").absolutePath))
    compilerOptions.freeCompilerArgs.set(listOf("@" + argfile.absolutePath))
}
`);
  await build(root, "testClasses");
  assert.deepEqual(await classFiles(path.join(root, "build/classes")), [
    ...expected.compiledClasses, expected.additionalClass,
  ].sort());
  const model = await project.sourceModelAsync({});
  assert.equal(model.status, "available", model.reason);
  assert.deepEqual(model.compilations.find((entry) => entry.task === ":compileTestKotlin").additionalSourcePaths,
    [path.join(root, expected.additionalSource)]);
  // Gradle 8.10 / Kotlin 2.2.21 in-process builds have different native and
  // Java cached working directories. Relative membership remains unverified.
  await fs.appendFile(path.join(root, "build.gradle.kts"), `
tasks.named<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>("compileTestKotlin") {
    compilerOptions.freeCompilerArgs.set(listOf("notes/Scratch.kt"))
}
`);
  const relative = await project.sourceModelAsync({});
  assert.equal(relative.status, "unavailable");
  assert.match(relative.reason, /Relative Kotlin arguments require a fixed compiler working directory/);
});

test("Gradle source model rejects an argument that the Kotlin compiler rejects", {
  skip: !process.env.GAUGE_LIFECYCLE_GRADLE,
  timeout: 180000,
}, async (t) => {
  const { root, project } = await fixture(t);
  await fs.appendFile(path.join(root, "build.gradle.kts"), `
tasks.named<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>("compileTestKotlin") {
    compilerOptions.freeCompilerArgs.set(listOf("-jvm-target"))
}
`);
  // The real Gradle compiler appends source operands after freeCompilerArgs;
  // the missing target value consumes a source path and fails target validation.
  await assert.rejects(build(root, "testClasses"), /Unknown JVM target version:/);
  const model = await project.sourceModelAsync({});
  assert.equal(model.status, "unavailable");
});
