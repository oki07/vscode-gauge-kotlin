"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { canonicalFilePath } = require("./gaugeExecutionIdentifier");

const SOURCE_TYPES = new Set(["java-source", "java-test", "java-resource", "java-test-resource"]);

function inside(file, root, pathModule = path) {
  return file === root || file.startsWith(root.endsWith(pathModule.sep) ? root : `${root}${pathModule.sep}`);
}

function exportedPath(value, directory) {
  if (typeof value !== "string") throw new Error("Invalid Kotlin source path.");
  const expanded = value.replace(/^<WORKSPACE>(?=\/|$)/, directory);
  if (!path.isAbsolute(expanded)) throw new Error("Unsupported Kotlin source path.");
  return canonicalFilePath(expanded);
}

function libraryPathMatches(file, exported) {
  if (path.isAbsolute(exported)) return canonicalFilePath(file) === canonicalFilePath(exported);
  const macro = exported.match(/^<(?:MAVEN_REPO|HOME)>\/(.+)$/);
  return macro ? file.replace(/\\/g, "/").endsWith(`/${macro[1]}`) : undefined;
}

function patternMatches(name, pattern) {
  const expression = pattern.split("").map((character) => {
    if (character === "*") return ".*";
    if (character === "?") return ".";
    return character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }).join("");
  return new RegExp(`^${expression}$`).test(name);
}

function modulesFrom(model, directory) {
  if (!Array.isArray(model?.modules)) throw new Error("Invalid Kotlin workspace model.");
  return model.modules.map((module, index) => {
    const contentRoots = module.contentRoots === undefined ? [] : module.contentRoots;
    if (!Array.isArray(contentRoots)) throw new Error("Invalid Kotlin content roots.");
    const contents = contentRoots.map((content) => {
      const sourceRoots = content.sourceRoots === undefined ? [] : content.sourceRoots;
      if (!Array.isArray(sourceRoots)) throw new Error("Invalid Kotlin source roots.");
      const patterns = content.excludedPatterns || [];
      const excluded = content.excludedUrls || [];
      if (!Array.isArray(patterns) || !patterns.every((entry) => typeof entry === "string")
        || !Array.isArray(excluded)) throw new Error("Invalid Kotlin source exclusions.");
      return {
        root: exportedPath(content.path, directory),
        patterns,
        excluded: excluded.map((entry) => exportedPath(entry, directory)),
        sources: sourceRoots.map((source) => {
          if (!SOURCE_TYPES.has(source.type)) throw new Error("Unsupported Kotlin source root type.");
          return { root: exportedPath(source.path, directory), resource: source.type.includes("resource") };
        }),
      };
    });
    const dependencies = (module.dependencies || []).filter((entry) => ["module", "library"].includes(entry.type)).map((entry) => {
      if (typeof entry.name !== "string" || !["compile", "test", "provided", "runtime"].includes(entry.scope)) {
        throw new Error("Invalid Kotlin module dependency.");
      }
      return { type: entry.type, name: entry.name, scope: entry.scope, exported: entry.isExported === true };
    });
    return { name: module.name ?? String(index), contents, dependencies, root: contents[0]?.root };
  });
}

// Kotlin/kotlin-lsp/vscode-extension-core/src/extension.ts exposes
// exportWorkspace as a snapshot of its imported IDE model. Failed imports can retain the preceding model; a snapshot is not proof
// that the current build configuration imported successfully.
class KotlinSourceScope {
  constructor(options = {}) {
    this.vscode = options.vscode || require("vscode");
    this.refreshIntervalMs = options.refreshIntervalMs ?? 5000;
    this.contents = [];
    this.modules = [];
    this.libraries = [];
    this.listeners = new Set();
    this.disposed = false;
    this.pending = undefined;
  }

  modulesFor(root) {
    const identity = canonicalFilePath(root);
    const initial = this.modules.filter((module) => module.root && inside(module.root, identity));
    const byName = new Map(this.modules.map((module) => [module.name, module]));
    const selected = new Set();
    const pending = [...initial];
    while (pending.length) {
      const module = pending.pop();
      if (selected.has(module)) continue;
      selected.add(module);
      for (const edge of module.dependencies) {
        if (edge.type !== "module" || edge.scope === "runtime" || (!initial.includes(module) && !edge.exported)) continue;
        const dependency = byName.get(edge.name);
        if (dependency) pending.push(dependency);
      }
    }
    return [...selected];
  }

  libraryRoots(root) {
    const modules = this.modulesFor(root);
    if (!modules.length) return undefined;
    const identity = canonicalFilePath(root);
    const selected = new Set(modules.flatMap((module) => module.dependencies
      .filter((edge) => edge.type === "library" && edge.scope !== "runtime"
        && (module.root && inside(module.root, identity) || edge.exported))
      .map((edge) => edge.name)));
    return this.libraries.flatMap((library) => library.roots
      .filter((entry) => (entry.type || "CLASSES") === "CLASSES")
      .map((entry) => ({ ...entry, selected: selected.has(library.name),
        ambiguous: this.libraries.filter((other) => other.name === library.name).length > 1,
        excludedRoots: library.excludedRoots,
        unsupported: Boolean(entry.inclusionOptions && entry.inclusionOptions !== "root_itself") })));
  }

  concreteLibraryRoots(root, classpath) {
    const roots = (this.libraryRoots(root) || []).filter((entry) => entry.selected && !entry.ambiguous && !entry.unsupported);
    return [...new Set(roots.flatMap((entry) => path.isAbsolute(entry.path) ? [entry.path]
      : classpath.filter((file) => typeof file === "string" && libraryPathMatches(file, entry.path))).map((file) => canonicalFilePath(file)))];
  }

  libraryClasspath(root, classpath) {
    const roots = this.libraryRoots(root);
    if (!roots) return classpath;
    const matches = (file, entry) => {
      if (entry.unsupported) return undefined;
      return libraryPathMatches(file, entry.path);
    };
    const retained = classpath.filter((file) => typeof file === "string").filter((file) => {
      const matching = roots.filter((entry) => matches(file, entry));
      return matching.some((entry) => entry.selected || entry.ambiguous)
        || roots.some((entry) => entry.selected && matches(file, entry) === undefined);
    });
    return [...new Set([...retained.map((file) => canonicalFilePath(file)), ...this.concreteLibraryRoots(root, []).filter((file) => /\.jar$/i.test(file))])];
  }

  libraryClassFilter(root, archive, directory = false) {
    const roots = this.libraryRoots(root);
    if (!roots) return () => true;
    const matching = roots.filter((entry) => libraryPathMatches(archive, entry.path));
    if (matching.some((entry) => entry.ambiguous || entry.selected && entry.unsupported)
      || roots.some((entry) => entry.selected && (entry.unsupported || libraryPathMatches(archive, entry.path) === undefined))) return () => true;
    const contributions = matching.filter((entry) => entry.selected).map((entry) => (entry.excludedRoots || []).flatMap((excluded) => {
      if (directory) {
        const physicalRoot = canonicalFilePath(archive);
        if (path.isAbsolute(excluded)) {
          const physicalExcluded = canonicalFilePath(excluded);
          return inside(physicalExcluded, physicalRoot) ? [path.relative(physicalRoot, physicalExcluded).split(path.sep).join("/")] : [];
        }
        if (excluded === entry.path) return [""];
        return excluded.startsWith(`${entry.path}/`) ? [excluded.slice(entry.path.length + 1)] : [];
      }
      const internal = excluded.match(/^(.*\.jar)!(?:\/(.*))?$/i);
      const file = internal ? internal[1] : excluded;
      return libraryPathMatches(archive, file) ? [internal ? internal[2] || "" : ""] : [];
    }));
    // getgauge/intellij-gauge-plugin/src/com/thoughtworks/gauge/util/StepUtil.java:
    // IDEA annotation search includes the union of unexcluded library classes.
    return (name) => contributions.some((exclusions) => !exclusions.some((excluded) =>
      excluded === "" || name === excluded || name.startsWith(`${excluded}/`)));
  }

  moduleRoots() {
    return [...new Set(this.modules.map((module) => module.root).filter(Boolean))];
  }

  sourceRoots() {
    return [...new Set(this.contents.flatMap((content) => content.sources.map((source) => source.root)))];
  }

  contextRoot(file) {
    const identity = canonicalFilePath(file);
    return this.modules.find((module) => module.contents.some((content) => content.sources.some((source) => inside(identity, source.root))))?.root;
  }

  canUse(root, dependencyRoot) {
    const identity = canonicalFilePath(dependencyRoot);
    return this.modulesFor(root).some((module) => module.root === identity);
  }

  allows(file, root) {
    if (this.disposed) return undefined;
    const identity = canonicalFilePath(file);
    const modules = root ? this.modulesFor(root) : undefined;
    if (modules && !modules.length) return undefined;
    const contents = modules ? modules.flatMap((module) => module.contents) : this.contents;
    const candidates = contents.filter((content) => inside(identity, content.root)
      || content.sources.some((source) => inside(identity, source.root)));
    if (!candidates.length) return modules ? false : undefined;
    return candidates.some((content) => {
      if (content.excluded.some((root) => inside(identity, root))) return false;
      const names = path.relative(content.root, identity).split(path.sep);
      if (names.some((name) => content.patterns.some((pattern) => patternMatches(name, pattern)))) return false;
      return content.sources.some((source) => inside(identity, source.root)
        && (!source.resource || !/\.java$/i.test(identity)));
    });
  }

  onDidChange(listener) {
    if (!this.disposed) this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  start() {
    if (this.disposed || this.started) return;
    this.started = true;
    void this.refresh();
    if (this.refreshIntervalMs > 0) {
      this.timer = setInterval(() => { void this.refresh(); }, this.refreshIntervalMs);
      this.timer.unref?.();
    }
  }

  refresh() {
    if (this.disposed) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = this.readSnapshot().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  async readSnapshot() {
    let directory;
    try {
      const extension = this.vscode.extensions?.getExtension?.("JetBrains.kotlin-server");
      if (!extension) return;
      if (!extension.isActive && extension.activate) await extension.activate();
      if (this.disposed) return;
      const commands = await this.vscode.commands.getCommands(true);
      if (this.disposed || !commands.includes("exportWorkspace")) return;
      directory = await fs.mkdtemp(path.join(os.tmpdir(), "gauge-kotlin-model-"));
      if (this.disposed) return;
      await this.vscode.commands.executeCommand("exportWorkspace", directory);
      if (this.disposed) return;
      const model = JSON.parse(await fs.readFile(path.join(directory, "workspace.json"), "utf8"));
      const modules = modulesFrom(model, directory);
      const libraryPath = (value) => {
        if (typeof value !== "string") throw new Error("Invalid Kotlin library path.");
        try { return exportedPath(value, directory); } catch (_error) { return value; }
      };
      const libraries = (model.libraries || []).map((library) => ({ ...library,
        roots: library.roots.map((entry) => ({ ...entry, path: libraryPath(entry.path) })),
        excludedRoots: (library.excludedRoots || []).map(libraryPath),
      }));
      if (this.disposed || JSON.stringify([modules, libraries]) === JSON.stringify([this.modules, this.libraries])) return;
      this.libraries = libraries;
      this.modules = modules;
      this.contents = modules.flatMap((module) => module.contents);
      for (const listener of [...this.listeners]) {
        try { listener(); } catch (_error) { /* One consumer cannot prevent the remaining consumers from refreshing. */ }
      }
    } catch (_error) {
      // An unavailable or unreadable export must not replace the last snapshot
      // with an empty source set. The next poll can observe recovery.
    } finally {
      if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  }

  dispose() {
    this.disposed = true;
    clearInterval(this.timer);
    this.listeners.clear();
    this.contents = [];
    this.modules = [];
    this.libraries = [];
  }
}

module.exports = { KotlinSourceScope, isWithinRoot: inside };
