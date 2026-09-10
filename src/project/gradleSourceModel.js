"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { randomBytes } = require("node:crypto");

function initScript(taskName) {
  return `gradle.projectsEvaluated {
    rootProject.tasks.register('${taskName}') {
        doLast {
            def target = rootProject.tasks.findByName('testClasses')
            if (target == null) throw new GradleException('No root testClasses task')
            def seen = [] as Set
            def compilations = []
            def argumentSources = { task, kotlin, values ->
                if (values.isEmpty()) return []
                if (!kotlin) return null
                def loader = task.class.classLoader
                // Gradle 8.10 / Kotlin 2.2.21 resolve daemon operands from its run
                // directory. Fallback can select a different compiler directory.
                def baseDirectory = {
                    def strategy = task.compilerExecutionStrategy.get().toString()
                    if (strategy == 'DAEMON' && !task.useDaemonFallbackStrategy.get()
                        && !task.normalizedKotlinDaemonJvmArguments.get().any {
                            it == 'Duser.dir' || it.startsWith('Duser.dir=')
                        }) {
                        def params = loader.loadClass('org.jetbrains.kotlin.daemon.common.DaemonParamsKt')
                        def directory = new File(params.configureDaemonOptions().runFilesPath)
                        if (directory.isAbsolute()) return directory.canonicalFile
                    }
                    throw new GradleException('Relative Kotlin arguments require a fixed compiler working directory')
                }
                def resolvePath = { value ->
                    def file = new File(value)
                    return (file.isAbsolute() ? file : new File(baseDirectory(), value)).canonicalPath
                }
                def parserValues = values.collect { value ->
                    value.startsWith('@') ? '@' + resolvePath(value.substring(1)) : value
                }
                def argumentType = loader.loadClass('org.jetbrains.kotlin.cli.common.arguments.K2JVMCompilerArguments')
                def parser = loader.loadClass('org.jetbrains.kotlin.cli.common.arguments.ParseCommandLineArgumentsKt')
                def arguments = argumentType.getConstructor().newInstance()
                parser.parseCommandLineArguments(parserValues, arguments, false)
                def error = parser.validateArguments(arguments.errors)
                if (error != null) throw new GradleException(error)
                return arguments.freeArgs.collect { resolvePath(it) }.unique().sort()
            }
            def inherits = { task, name ->
                def type = task.class
                while (type != null) {
                    if (type.name == name) return true
                    type = type.superclass
                }
                return false
            }
            def visit
            visit = { task ->
                if (!seen.add(task.path)) return
                def kotlin = inherits(task, 'org.jetbrains.kotlin.gradle.tasks.KotlinCompile')
                def java = task instanceof org.gradle.api.tasks.compile.JavaCompile
                if (kotlin || java) {
                    def extra = kotlin ? task.compilerOptions.freeCompilerArgs.get() : task.options.compilerArgs
                    compilations.add([
                        task: task.path,
                        language: kotlin ? 'kotlin' : 'java',
                        sourceFiles: (kotlin ? task.sources : task.source).files.collect { it.canonicalPath }.sort(),
                        javaSourceFiles: kotlin ? task.javaSources.files.collect { it.canonicalPath }.sort() : [],
                        additionalArguments: extra,
                        additionalSourcePaths: argumentSources(task, kotlin, extra),
                        outputDirectory: task.destinationDirectory.get().asFile.canonicalPath
                    ])
                }
                task.taskDependencies.getDependencies(task).each { visit(it) }
            }
            visit(target)
            if (compilations.isEmpty()) throw new GradleException('No JVM compiler tasks')
            def result = [version: 1, projectRoot: rootProject.projectDir.canonicalPath,
                compilations: compilations.sort { it.task }]
            new File(rootProject.property('gaugeSourceModelOutput')).text =
                groovy.json.JsonOutput.toJson(result)
        }
    }
}
`;
}

function query(command, args, options) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = command.spawn(args, {
        cwd: options.projectRoot,
        signal: options.signal,
        timeout: options.timeoutMs ?? 120000,
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch (error) {
      reject(error);
      return;
    }
    let stderr = "";
    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + String(chunk)).slice(-16384);
      });
    }
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Gradle source query exited with code ${code}.`));
    });
  });
}

function validPaths(value) {
  return Array.isArray(value) && value.every((file) => typeof file === "string" && path.isAbsolute(file));
}

function validateModel(model, projectRoot) {
  if (!model || model.version !== 1 || model.projectRoot !== projectRoot
    || !Array.isArray(model.compilations) || model.compilations.length === 0) {
    throw new Error("Gradle returned an unsupported source model.");
  }
  const tasks = new Set();
  for (const compilation of model.compilations) {
    if (!compilation || typeof compilation.task !== "string" || !compilation.task.startsWith(":")
      || tasks.has(compilation.task) || !["java", "kotlin"].includes(compilation.language)
      || !validPaths(compilation.sourceFiles) || !validPaths(compilation.javaSourceFiles)
      || !Array.isArray(compilation.additionalArguments)
      || !compilation.additionalArguments.every((argument) => typeof argument === "string")
      || !(validPaths(compilation.additionalSourcePaths)
        || (compilation.language === "java" && compilation.additionalSourcePaths === null))
      || typeof compilation.outputDirectory !== "string" || !path.isAbsolute(compilation.outputDirectory)) {
      throw new Error("Gradle returned an invalid compiler source collection.");
    }
    tasks.add(compilation.task);
  }
  return model;
}

async function readGradleSourceModel(projectRoot, command, options = {}) {
  let directory;
  try {
    const canonicalRoot = await fs.realpath(projectRoot);
    directory = await fs.mkdtemp(path.join(options.temporaryDirectory || os.tmpdir(), "gauge-sources-"));
    const script = path.join(directory, "sources.gradle");
    const output = path.join(directory, "sources.json");
    const task = `gaugeSourceModel${randomBytes(8).toString("hex")}`;
    await fs.writeFile(script, initScript(task));
    await query(command, [
      "-q", "--console=plain", "--no-configuration-cache", "-I", script,
      `-PgaugeSourceModelOutput=${output}`, task,
    ], { ...options, projectRoot: canonicalRoot });
    const model = validateModel(JSON.parse(await fs.readFile(output, "utf8")), canonicalRoot);
    return { ...model, status: "available" };
  } catch (error) {
    return { status: "unavailable", reason: String(error && error.message ? error.message : error) };
  } finally {
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
}

module.exports = { readGradleSourceModel };
