"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { canonicalFilePath } = require("./gaugeExecutionIdentifier");

const SOURCE_TYPES = new Set(["java-source", "java-test", "java-resource", "java-test-resource"]);

function inside(file, root) {
  return file === root || file.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`);
}

function exportedPath(value, directory) {
  if (typeof value !== "string") throw new Error("Invalid Kotlin source path.");
  const expanded = value.replace(/^<WORKSPACE>(?=\/|$)/, directory);
  if (!path.isAbsolute(expanded)) throw new Error("Unsupported Kotlin source path.");
  return canonicalFilePath(expanded);
}

function patternMatches(name, pattern) {
  const expression = pattern.split("").map((character) => {
    if (character === "*") return ".*";
    if (character === "?") return ".";
    return character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }).join("");
  return new RegExp(`^${expression}$`).test(name);
}

function contentsFrom(model, directory) {
  if (!Array.isArray(model?.modules)) throw new Error("Invalid Kotlin workspace model.");
  return model.modules.flatMap((module) => {
    const contentRoots = module.contentRoots === undefined ? [] : module.contentRoots;
    if (!Array.isArray(contentRoots)) throw new Error("Invalid Kotlin content roots.");
    return contentRoots.map((content) => {
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
    this.listeners = new Set();
    this.disposed = false;
    this.pending = undefined;
  }

  allows(file) {
    if (this.disposed) return undefined;
    const identity = canonicalFilePath(file);
    const candidates = this.contents.filter((content) => inside(identity, content.root)
      || content.sources.some((source) => inside(identity, source.root)));
    if (!candidates.length) return undefined;
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
      const contents = contentsFrom(JSON.parse(await fs.readFile(path.join(directory, "workspace.json"), "utf8")), directory);
      if (this.disposed || JSON.stringify(contents) === JSON.stringify(this.contents)) return;
      this.contents = contents;
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
  }
}

module.exports = { KotlinSourceScope };
