"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Command } = require("../cli");
const observer = require("./mavenSourceObserver");

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = command.spawn(args, {
      cwd: options.projectRoot, signal: options.signal,
      timeout: options.timeoutMs ?? 180000, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-16384); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-16384); });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || stdout.trim() || `Compiler observation exited with code ${code}.`));
    });
  });
}

function paths(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && path.isAbsolute(entry));
}

function validate(model, root) {
  if (!model || model.error || model.version !== 1 || model.projectRoot !== root
    || !Array.isArray(model.languages) || model.languages.length !== 1 || model.languages[0] !== "kotlin"
    || !Array.isArray(model.compilations) || model.compilations.length === 0) {
    throw new Error(model?.error || "Maven returned no supported compiler observation.");
  }
  for (const item of model.compilations) {
    if (!item || item.language !== "kotlin" || !["compile", "test-compile"].includes(item.goal)
      || typeof item.executionId !== "string" || item.compilerVersion !== "2.2.21"
      || typeof item.skipped !== "boolean" || typeof item.hasSources !== "boolean"
      || !paths([item.projectRoot, item.configuredOutputDirectory])
      || !paths(item.sourcePaths) || !paths(item.additionalSourcePaths)) {
      throw new Error("Maven returned an invalid compiler observation.");
    }
  }
  return model;
}

async function readMavenSourceModel(projectRoot, command, options = {}) {
  let directory;
  try {
    const root = await fs.realpath(projectRoot);
    const settings = { ...options, projectRoot: root };
    if (!command?.spawn) command = new Command(command.command, "", Boolean(command.shellMode));
    const version = await run(command, ["-B", "-ntp", "-Dstyle.color=never", "--version"], settings);
    const home = /^Maven home: (.+)$/m.exec(version)?.[1].trim();
    const runtime = /runtime: (.+)$/m.exec(version)?.[1].trim();
    if (!home || !runtime || !paths([home, runtime])) throw new Error("Cannot locate the Maven runtime.");
    const library = path.join(home, "lib");
    const jars = (await fs.readdir(library)).filter((name) => name.endsWith(".jar"))
      .sort().map((name) => path.join(library, name));
    if (!jars.length) throw new Error("Maven compiler APIs are unavailable.");
    directory = await fs.mkdtemp(path.join(options.temporaryDirectory || os.tmpdir(), "gauge-maven-sources-"));
    const classes = path.join(directory, "classes");
    const metadata = path.join(classes, "META-INF", "plexus");
    await fs.mkdir(metadata, { recursive: true });
    const source = path.join(directory, "SourceModelObserver.java");
    await fs.writeFile(source, observer);
    const components = ["org.apache.maven.execution.MojoExecutionListener", "org.apache.maven.AbstractMavenLifecycleParticipant"]
      .map((role) => `<component><role>${role}</role><role-hint>gauge-kotlin-sources</role-hint><implementation>SourceModelObserver</implementation></component>`)
      .join("");
    await fs.writeFile(path.join(metadata, "components.xml"), `<component-set><components>${components}</components></component-set>`);
    const compiler = options.compilerCommand || new Command(path.join(runtime, "bin", process.platform === "win32" ? "javac.exe" : "javac"));
    await run(compiler, ["-proc:none", "-source", "8", "-target", "8", "-Xlint:-options",
      "-classpath", jars.join(path.delimiter), "-d", classes, source], settings);
    const output = path.join(directory, "sources.json");
    await run(command, ["-B", "-ntp", "-Dstyle.color=never", `-Dmaven.ext.class.path=${classes}`,
      `-Dgauge.source.model.output=${output}`, "test-compile"], settings);
    return { ...validate(JSON.parse(await fs.readFile(output, "utf8")), root), status: "available" };
  } catch (error) {
    return { status: "unavailable", reason: String(error?.message || error) };
  } finally {
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
}

module.exports = { readMavenSourceModel };
