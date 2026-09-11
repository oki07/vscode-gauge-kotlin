"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");

const { GAUGE_CUSTOM_CLASSPATH } = require("./project/classpath");
const { isWithinRoot, isArchiveFile } = require("./kotlinSourceScope");
const { canonicalFilePath } = require("./gaugeExecutionIdentifier");
const { annotationStepTemplate } = require("./gaugeStepValue");

const GAUGE_DEPENDENCY_SCHEME = "gauge-dependency";
const GAUGE_STEP_DESCRIPTOR = "Lcom/thoughtworks/gauge/Step;";
const MAX_CLASS_BYTES = 16 * 1024 * 1024;

function getVscode(vscode) {
  return vscode || require("vscode");
}

class ClassReader {
  constructor(buffer) {
    this.buffer = buffer;
    this.offset = 0;
  }

  u1() {
    const value = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  u2() {
    const value = this.buffer.readUInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  u4() {
    const value = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  bytes(length) {
    const value = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  skip(length) {
    this.offset += length;
  }
}

function readConstantPool(reader) {
  const count = reader.u2();
  const pool = new Array(count);
  for (let index = 1; index < count; index += 1) {
    const tag = reader.u1();
    if (tag === 1) {
      const length = reader.u2();
      pool[index] = { tag, value: reader.bytes(length).toString("utf8") };
    } else if (tag === 7) {
      pool[index] = { nameIndex: reader.u2(), tag };
    } else if (tag === 8) {
      pool[index] = { stringIndex: reader.u2(), tag };
    } else if (tag === 3 || tag === 4) {
      pool[index] = { tag };
      reader.skip(4);
    } else if (tag === 5 || tag === 6) {
      pool[index] = { tag };
      reader.skip(8);
      index += 1;
    } else if ([9, 10, 11, 12, 17, 18].includes(tag)) {
      pool[index] = { tag };
      reader.skip(4);
    } else if (tag === 15) {
      pool[index] = { tag };
      reader.skip(3);
    } else if ([16, 19, 20].includes(tag)) {
      pool[index] = { tag };
      reader.skip(2);
    } else {
      throw new Error(`Unsupported class constant pool tag ${tag}`);
    }
  }
  return pool;
}

function utf8(pool, index) {
  const entry = pool[index];
  return entry && entry.tag === 1 ? entry.value : undefined;
}

function className(pool, index) {
  const entry = pool[index];
  return entry && entry.tag === 7 ? utf8(pool, entry.nameIndex) : undefined;
}

function readElementValue(reader, pool) {
  const tag = String.fromCharCode(reader.u1());
  if (tag === "s") {
    return utf8(pool, reader.u2());
  }
  if ("BCDFIJSZ".includes(tag)) {
    reader.u2();
    return undefined;
  }
  if (tag === "e") {
    reader.skip(4);
    return undefined;
  }
  if (tag === "c") {
    reader.skip(2);
    return undefined;
  }
  if (tag === "@") {
    readAnnotation(reader, pool);
    return undefined;
  }
  if (tag === "[") {
    const values = [];
    const count = reader.u2();
    for (let index = 0; index < count; index += 1) {
      const value = readElementValue(reader, pool);
      if (value !== undefined) {
        values.push(value);
      }
    }
    return values;
  }
  throw new Error(`Unsupported annotation element tag ${tag}`);
}

function readAnnotation(reader, pool) {
  const type = utf8(pool, reader.u2());
  const values = new Map();
  const pairCount = reader.u2();
  for (let index = 0; index < pairCount; index += 1) {
    const name = utf8(pool, reader.u2());
    values.set(name, readElementValue(reader, pool));
  }
  return { type, values };
}

function readAnnotations(reader, pool) {
  const annotations = [];
  const count = reader.u2();
  for (let index = 0; index < count; index += 1) {
    annotations.push(readAnnotation(reader, pool));
  }
  return annotations;
}

function skipAttributes(reader) {
  const count = reader.u2();
  for (let index = 0; index < count; index += 1) {
    reader.u2();
    reader.skip(reader.u4());
  }
}

function skipMember(reader) {
  reader.skip(6);
  skipAttributes(reader);
}

function annotationAliases(annotation) {
  if (!annotation || annotation.type !== GAUGE_STEP_DESCRIPTOR) {
    return [];
  }
  const value = annotation.values.get("value");
  if (typeof value === "string") {
    return [value];
  }
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

function parseDependencyClass(buffer, artifact = "") {
  const reader = new ClassReader(buffer);
  if (reader.u4() !== 0xcafebabe) {
    throw new Error("Invalid Java class file magic");
  }
  reader.skip(4);
  const pool = readConstantPool(reader);
  reader.u2();
  const thisClass = reader.u2();
  reader.u2();
  const interfaceCount = reader.u2();
  reader.skip(interfaceCount * 2);
  const fieldCount = reader.u2();
  for (let index = 0; index < fieldCount; index += 1) {
    skipMember(reader);
  }

  const steps = [];
  const methodCount = reader.u2();
  for (let index = 0; index < methodCount; index += 1) {
    reader.u2();
    const methodName = utf8(pool, reader.u2());
    const descriptor = utf8(pool, reader.u2());
    const attributeCount = reader.u2();
    let aliases = [];
    for (let attributeIndex = 0; attributeIndex < attributeCount; attributeIndex += 1) {
      const attributeName = utf8(pool, reader.u2());
      const attributeLength = reader.u4();
      const attributeEnd = reader.offset + attributeLength;
      if (
        attributeName === "RuntimeVisibleAnnotations"
        || attributeName === "RuntimeInvisibleAnnotations"
      ) {
        for (const annotation of readAnnotations(reader, pool)) {
          aliases.push(...annotationAliases(annotation));
        }
      }
      reader.offset = attributeEnd;
    }
    if (aliases.length > 0) {
      steps.push({ aliases, descriptor, methodName });
    }
  }

  let sourceFile;
  const classAttributeCount = reader.u2();
  for (let index = 0; index < classAttributeCount; index += 1) {
    const attributeName = utf8(pool, reader.u2());
    const attributeLength = reader.u4();
    const attributeEnd = reader.offset + attributeLength;
    if (attributeName === "SourceFile" && attributeLength === 2) {
      sourceFile = utf8(pool, reader.u2());
    }
    reader.offset = attributeEnd;
  }

  const internalName = className(pool, thisClass);
  return {
    artifact,
    className: internalName && internalName.replaceAll("/", "."),
    internalName,
    sourceFile,
    steps,
  };
}

function isEscapedAt(text, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function parameterEnd(text, start, close) {
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === "\\" && close === "\"") {
      index += 1;
    } else if (text[index] === close && !isEscapedAt(text, index)) {
      return index;
    }
  }
  return -1;
}

function nextParameter(text, start) {
  let dynamic = text.indexOf("<", start);
  while (dynamic !== -1 && isEscapedAt(text, dynamic)) {
    dynamic = text.indexOf("<", dynamic + 1);
  }
  let quoted = text.indexOf("\"", start);
  while (quoted !== -1 && isEscapedAt(text, quoted)) {
    quoted = text.indexOf("\"", quoted + 1);
  }
  if (dynamic === -1 && quoted === -1) {
    return undefined;
  }
  return quoted === -1 || (dynamic !== -1 && dynamic < quoted)
    ? { close: ">", start: dynamic }
    : { close: "\"", start: quoted };
}

function literalStepText(text) {
  let value = "";
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\\") {
      if (index + 1 < text.length) {
        value += text[index + 1] === "{" || text[index + 1] === "}"
          ? text[index + 1]
          : text.slice(index, index + 2);
        index += 1;
      }
    } else if (text[index] === "{" || text[index] === "}") {
      return undefined;
    } else {
      value += text[index];
    }
  }
  return value;
}

function normalizeStepTemplate(text) {
  let value = "";
  let index = 0;
  while (index < text.length) {
    const parameter = nextParameter(text, index);
    if (!parameter) {
      const literal = literalStepText(text.slice(index));
      return literal === undefined ? undefined : `${value}${literal}`.trim().normalize("NFC");
    }
    const end = parameterEnd(text, parameter.start, parameter.close);
    const literal = literalStepText(text.slice(index, parameter.start));
    if (end === -1 || literal === undefined) {
      return undefined;
    }
    value += `${literal}{}`;
    index = end + 1;
  }
  return value.trim().normalize("NFC");
}

function readStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

async function scanClassDirectory(root, visit) {
  const fileSystem = nodeFs.promises;
  const walk = async (directory, relative, ancestors) => {
    let physical;
    let children;
    try {
      physical = await fileSystem.realpath(directory);
      if (ancestors.has(physical)) return;
      children = await fileSystem.readdir(directory, { withFileTypes: true });
    } catch (_error) { return; }
    const parents = new Set([...ancestors, physical]);
    for (const child of children) {
      const file = nodePath.join(directory, child.name);
      const name = relative ? `${relative}/${child.name}` : child.name;
      let stat;
      try { stat = await fileSystem.stat(file); } catch (_error) { continue; }
      if (stat.isDirectory()) {
        await walk(file, name, parents);
      } else if (stat.isFile() && name.endsWith(".class") && stat.size <= MAX_CLASS_BYTES) {
        let data;
        try { data = await fileSystem.readFile(file); } catch (_error) { continue; }
        if (data.length <= MAX_CLASS_BYTES) await visit(name, data);
      }
    }
  };
  await walk(root, "", new Set());
}

function logicalFilePath(file) {
  return nodePath.join(canonicalFilePath(nodePath.dirname(file)), nodePath.basename(file));
}

async function discoverArchives(root, recursive, onWatch) {
  const found = new Set();
  const watches = new Map();
  const watch = (value) => {
    const key = JSON.stringify(value);
    if (watches.has(key)) return;
    watches.set(key, value);
    onWatch([value]);
  };
  const followLinks = async (file) => {
    const seen = new Set();
    while (true) {
      const logical = logicalFilePath(file);
      if (seen.has(logical)) return;
      seen.add(logical);
      let stat;
      try { stat = await nodeFs.promises.lstat(file); } catch (_error) { watch(file); return; }
      if (!stat.isSymbolicLink()) { watch(file); return; }
      watch({ path: logical, logical: true });
      try { file = nodePath.resolve(nodePath.dirname(file), await nodeFs.promises.readlink(file)); } catch (_error) { return; }
    }
  };
  const walk = async (directory, ancestors) => {
    let physical;
    let children;
    try {
      physical = await nodeFs.promises.realpath(directory);
      if (ancestors.has(physical)) return;
      watch(physical);
      children = await nodeFs.promises.readdir(directory, { withFileTypes: true });
    } catch (_error) { return; }
    const parents = new Set([...ancestors, physical]);
    for (const child of children) {
      const file = nodePath.join(directory, child.name);
      if (child.isSymbolicLink() && (recursive || isArchiveFile(file))) await followLinks(file);
      let stat;
      try { stat = await nodeFs.promises.stat(file); } catch (_error) { continue; }
      if (stat.isDirectory() && recursive) await walk(file, parents);
      else if (stat.isFile() && isArchiveFile(file)) {
        watch(file);
        found.add(file);
      }
    }
  };
  await walk(root, new Set());
  return { files: [...found].sort(), watches: [...watches.values()] };
}

function scanJarArchive(archivePath, visit) {
  const yauzl = require("yauzl");
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError) {
        reject(openError);
        return;
      }
      let settled = false;
      const fail = (error) => {
        if (!settled) {
          settled = true;
          zipFile.close();
          reject(error);
        }
      };
      zipFile.on("error", fail);
      zipFile.on("end", () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      });
      zipFile.on("entry", (entry) => {
        const isClass = entry.fileName.endsWith(".class")
          && !entry.fileName.startsWith("META-INF/")
          && entry.uncompressedSize <= MAX_CLASS_BYTES;
        if (!isClass) {
          zipFile.readEntry();
          return;
        }
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError) {
            fail(streamError);
            return;
          }
          readStream(stream)
            .then((data) => visit(entry.fileName, data))
            .then(() => zipFile.readEntry())
            .catch(fail);
        });
      });
      zipFile.readEntry();
    });
  });
}

function createPosition(vscode, line, character) {
  return typeof vscode.Position === "function"
    ? new vscode.Position(line, character)
    : { line, character };
}

function createRange(vscode, line, start, end) {
  const startPosition = createPosition(vscode, line, start);
  const endPosition = createPosition(vscode, line, end);
  return typeof vscode.Range === "function"
    ? new vscode.Range(startPosition, endPosition)
    : { start: startPosition, end: endPosition };
}

function quote(value) {
  return JSON.stringify(value);
}

function dependencyIdentity(entry) {
  return JSON.stringify([entry.artifact, entry.className, entry.methodName, entry.descriptor]);
}

function declarationFor(entry) {
  const classParts = entry.className.split(".");
  const simpleClassName = classParts.pop();
  const packageName = classParts.join(".");
  const lines = [
    "/*",
    " * Gauge dependency bytecode declaration.",
    ` * Artifact: ${entry.artifact}`,
    " */",
    packageName ? `package ${packageName};` : "",
    "",
    `final class ${simpleClassName} {`,
    `  @Step(${entry.aliases.map(quote).join(", ")})`,
    `  void ${entry.methodName}();`,
    "}",
    "",
  ];
  const methodLine = 8;
  const methodStart = lines[methodLine].indexOf(entry.methodName);
  return {
    content: lines.join("\n"),
    methodEnd: methodStart + entry.methodName.length,
    methodLine,
    methodStart,
  };
}

function projectForRoot(projectFactory, root) {
  if (!projectFactory) {
    return undefined;
  }
  if (typeof projectFactory.get === "function") {
    return projectFactory.get(root);
  }
  if (typeof projectFactory.getProjectByFilepath === "function") {
    return projectFactory.getProjectByFilepath(root);
  }
  return undefined;
}

class DependencyStepIndex {
  constructor(options = {}) {
    this.cli = options.cli;
    this.sourceScope = options.sourceScope;
    this.fileSystem = options.fileSystem || nodeFs;
    this.pathModule = options.pathModule || nodePath;
    this.projectFactory = options.projectFactory;
    this.projectEnvironmentService = options.projectEnvironmentService;
    this.scanArchive = options.scanArchive || scanJarArchive;
    this.scanDirectory = options.scanDirectory || scanClassDirectory;
    this.vscode = getVscode(options.vscode);
    this.classpathProvider = options.classpathProvider || ((root) => this.projectClasspath(root));
    this.binaryWatchers = new Map();
    this.invalidationListeners = new Set();
    this.contents = new Map();
    this.declarations = new Map();
    this.contentChanges = this.vscode.EventEmitter ? new this.vscode.EventEmitter() : undefined;
    this.globalInvalidationGeneration = 0;
    this.indices = new Map();
    this.pending = new Map();
    this.rootInvalidationGenerations = new Map();
    this.generation = 0;
    this.disposed = false;
  }

  updateTrackedDeclarations(root, index, changedArtifact) {
    if (!index && !changedArtifact) return;
    const entries = new Map();
    for (const candidates of (index || changedArtifact && this.indices.get(root))?.entriesByTemplate.values() || []) for (const entry of candidates) entries.set(dependencyIdentity(entry), entry);
    for (const [key, tracked] of this.declarations) {
      if (root !== undefined && tracked.root !== root) continue;
      if (changedArtifact && !entries.has(tracked.identity) && ![tracked.artifact, tracked.physicalArtifact].some((file) => file && isWithinRoot(file, changedArtifact, this.pathModule))) continue;
      if (changedArtifact) tracked.dirty = true;
      const entry = index ? entries.get(tracked.identity) : undefined;
      if (!entry && !tracked.dirty) continue;
      if (entry) { tracked.dirty = false; tracked.physicalArtifact = canonicalFilePath(entry.artifact); }
      const next = entry ? declarationFor(entry).content : undefined;
      const previous = this.contents.get(key);
      if (next === undefined) {
        this.contents.delete(key);
        this.contents.delete(tracked.uri.query);
      } else {
        this.contents.set(key, next);
        this.contents.set(tracked.uri.query, next);
      }
      if (previous !== next) this.contentChanges?.fire(tracked.uri);
    }
  }

  onDidInvalidate(listener) {
    this.invalidationListeners.add(listener);
    return { dispose: () => this.invalidationListeners.delete(listener) };
  }

  clearBinaryWatches() {
    for (const entry of this.binaryWatchers.values()) for (const disposable of entry.disposables) disposable?.dispose();
    this.binaryWatchers.clear();
  }

  syncBinaryWatches(root, files, retainExisting = false) {
    const workspace = this.vscode.workspace || {};
    if (this.disposed || !workspace.createFileSystemWatcher || !this.vscode.RelativePattern) return;
    const selected = new Set(files.flatMap((file) => typeof file === "string" ? [canonicalFilePath(file)]
      : file?.logical && typeof file.path === "string" ? [logicalFilePath(file.path)] : []));
    if (!retainExisting) for (const [file, entry] of this.binaryWatchers) {
      if (!selected.has(file)) entry.roots.delete(root);
      if (!entry.roots.size) {
        for (const disposable of entry.disposables) disposable?.dispose();
        this.binaryWatchers.delete(file);
      }
    }
    for (const file of selected) {
      let entry = this.binaryWatchers.get(file);
      if (!entry) {
        const disposables = [];
        try {
          let directory = !isArchiveFile(file);
          try { directory = this.fileSystem.statSync?.(file).isDirectory() ?? directory; } catch (_error) { /* Missing roots still need recreation events. */ }
          let base = this.pathModule.dirname(file);
          while (base !== this.pathModule.dirname(base)) {
            let exists = false;
            try { exists = this.fileSystem.statSync ? this.fileSystem.statSync(base).isDirectory() : this.fileSystem.existsSync(base); } catch (_error) { /* Watch an ancestor until the build creates its output directories. */ }
            if (exists) break;
            base = this.pathModule.dirname(base);
          }
          const watcher = workspace.createFileSystemWatcher(new this.vscode.RelativePattern(base, "**/*"));
          disposables.push(watcher);
          entry = { roots: new Set(), disposables, directory };
          const tracked = entry;
          const changed = (uri) => {
            const candidate = uri?.fsPath || uri?.path;
            if (this.disposed || typeof candidate !== "string") return;
            const identities = [canonicalFilePath(candidate), logicalFilePath(candidate)];
            if (!identities.some((identity) => identity === file || tracked.directory && isWithinRoot(identity, file, this.pathModule))) return;
            for (const consumer of [...tracked.roots]) this.invalidate(consumer, file);
          };
          for (const event of ["onDidCreate", "onDidChange", "onDidDelete"]) if (watcher[event]) disposables.push(watcher[event](changed));
          this.binaryWatchers.set(file, entry);
        } catch (_error) {
          for (const disposable of disposables) disposable?.dispose();
          continue;
        }
      }
      try { entry.directory = this.fileSystem.statSync?.(file).isDirectory() ?? entry.directory; } catch (_error) { /* Retain the last known kind while a target is absent. */ }
      entry.roots.add(root);
    }
  }

  async projectClasspath(root) {
    if (this.disposed) {
      return [];
    }
    const project = projectForRoot(this.projectFactory, root);
    if (
      !project
      || (
        typeof project.envs !== "function"
        && typeof project.envsAsync !== "function"
        && !this.projectEnvironmentService
      )
    ) {
      return [];
    }
    const environment = this.projectEnvironmentService
      && typeof this.projectEnvironmentService.environmentFor === "function"
      ? await this.projectEnvironmentService.environmentFor(project, this.cli)
      : await (
        typeof project.envsAsync === "function"
          ? project.envsAsync(this.cli)
          : Promise.resolve(project.envs(this.cli) || {})
      );
    if (this.disposed || !environment) {
      return [];
    }
    const classpath = environment[GAUGE_CUSTOM_CLASSPATH];
    return typeof classpath === "string" ? classpath.split(this.pathModule.delimiter) : [];
  }

  async buildIndex(root) {
    if (this.disposed) {
      return undefined;
    }
    const executionClasspath = await this.classpathProvider(root);
    const classpath = this.sourceScope?.libraryClasspath?.(root, Array.isArray(executionClasspath) ? executionClasspath : []) || executionClasspath;
    if (this.disposed) {
      return undefined;
    }
    const concreteRoots = this.sourceScope?.concreteLibraryRoots?.(root, Array.isArray(executionClasspath) ? executionClasspath : []) || [];
    const jarPaths = (Array.isArray(classpath) ? classpath : []).filter((entry) => typeof entry === "string" && entry.toLowerCase().endsWith(".jar"));
    const discoveryRoots = this.sourceScope?.archiveDirectoryRoots?.(root, Array.isArray(executionClasspath) ? executionClasspath : []) || [];
    // Watch discovery roots before enumeration so new archives cannot be missed.
    const baseWatches = [...jarPaths, ...concreteRoots, ...discoveryRoots.map((entry) => entry.path)];
    this.syncBinaryWatches(root, baseWatches, true);
    const discovery = await Promise.all(discoveryRoots.map((entry) => discoverArchives(entry.path, entry.recursive,
      (files) => this.syncBinaryWatches(root, files, true))));
    this.syncBinaryWatches(root, [...baseWatches, ...discovery.flatMap((entry) => entry.watches)]);
    const discovered = discovery.flatMap((entry) => entry.files);
    const directories = new Set(concreteRoots.filter((entry) => {
      try { return this.fileSystem.statSync?.(entry).isDirectory(); } catch (_error) { return false; }
    }));
    const archives = [...new Set([...jarPaths.filter((entry) => this.fileSystem.existsSync(entry)), ...directories, ...discovered])];
    const classpathKey = archives.join("\n");
    const previous = this.indices.get(root);
    if (previous && previous.classpathKey === classpathKey) {
      return previous;
    }

    const entriesByTemplate = new Map();
    for (const archive of archives) {
      if (this.disposed) {
        return undefined;
      }
      // A classpath routinely holds jars this process cannot open: a truncated
      // download, a permission-denied artifact, a native jar. One of them must
      // not throw away every other dependency's steps.
      const includesClass = this.sourceScope?.libraryClassFilter?.(root, archive, directories.has(archive)) || (() => true);
      await this.scanArchiveSafely(archive, async (fileName, data) => {
        if (this.disposed || !includesClass(fileName)) {
          return;
        }
        let parsed;
        try {
          parsed = parseDependencyClass(data, archive);
        } catch (_error) {
          return;
        }
        if (!parsed.className) {
          return;
        }
        for (const step of parsed.steps) {
          const entry = { ...parsed, ...step };
          for (const alias of step.aliases) {
            const normalized = annotationStepTemplate(alias);
            if (!normalized) {
              continue;
            }
            if (!entriesByTemplate.has(normalized)) {
              entriesByTemplate.set(normalized, []);
            }
            const candidates = entriesByTemplate.get(normalized);
            if (!candidates.some((candidate) => dependencyIdentity(candidate) === dependencyIdentity(entry))) candidates.push(entry);
          }
        }
      }, directories.has(archive));
      if (this.disposed) {
        return undefined;
      }
    }
    if (this.disposed) {
      return undefined;
    }
    return { classpathKey, entriesByTemplate };
  }

  async scanArchiveSafely(archive, visit, directory = false) {
    try {
      await (directory ? this.scanDirectory : this.scanArchive)(archive, visit);
    } catch (_error) {
      // Skipping one archive keeps the rest of the classpath indexed.
    }
  }

  invalidationSnapshot(root) {
    return {
      global: this.globalInvalidationGeneration,
      root: this.rootInvalidationGenerations.get(root) || 0,
    };
  }

  invalidationSnapshotCurrent(root, snapshot) {
    return snapshot.global === this.globalInvalidationGeneration
      && snapshot.root === (this.rootInvalidationGenerations.get(root) || 0);
  }

  async buildCurrentIndex(root) {
    while (!this.disposed) {
      const snapshot = this.invalidationSnapshot(root);
      let index;
      try {
        index = await this.buildIndex(root);
      } catch (error) {
        if (this.disposed) {
          return undefined;
        }
        if (!this.invalidationSnapshotCurrent(root, snapshot)) {
          continue;
        }
        throw error;
      }
      if (this.disposed) {
        return undefined;
      }
      if (!this.invalidationSnapshotCurrent(root, snapshot)) {
        continue;
      }
      if (index && this.indices.get(root) !== index) {
        this.indices.set(root, index);
        this.generation += 1;
        this.updateTrackedDeclarations(root, index);
      }
      return index;
    }
    return undefined;
  }

  refresh(root, force = false) {
    if (this.disposed || !root) {
      return Promise.resolve(undefined);
    }
    if (!force && this.indices.has(root)) {
      const snapshot = this.invalidationSnapshot(root);
      const cached = this.indices.get(root);
      return Promise.resolve(cached).then((index) => {
        if (this.disposed) {
          return undefined;
        }
        if (
          !this.invalidationSnapshotCurrent(root, snapshot)
          || this.indices.get(root) !== index
        ) {
          return this.refresh(root);
        }
        return index;
      });
    }
    if (this.pending.has(root)) {
      return this.pending.get(root);
    }
    const refresh = this.buildCurrentIndex(root)
      .finally(() => {
        if (this.pending.get(root) === refresh) {
          this.pending.delete(root);
        }
      });
    this.pending.set(root, refresh);
    return refresh;
  }

  invalidate(root, changedArtifact) {
    if (this.disposed) {
      return;
    }
    this.updateTrackedDeclarations(root, undefined, changedArtifact);
    if (root) {
      this.rootInvalidationGenerations.set(
        root,
        (this.rootInvalidationGenerations.get(root) || 0) + 1,
      );
      this.indices.delete(root);
    } else {
      this.clearBinaryWatches();
      this.globalInvalidationGeneration += 1;
      this.rootInvalidationGenerations.clear();
      this.indices.clear();
    }
    this.generation += 1;
    for (const listener of [...this.invalidationListeners]) {
      try { listener(root); } catch (_error) { /* Other consumers must still receive invalidation. */ }
    }
  }

  stepTemplates(root) {
    if (this.disposed) {
      return new Set();
    }
    const index = this.indices.get(root);
    return new Set(index ? index.entriesByTemplate.keys() : []);
  }

  uriFor(entry, root) {
    const identity = Buffer.from(JSON.stringify([
      root,
      entry.artifact,
      entry.className,
      entry.methodName,
      entry.descriptor,
    ])).toString("base64url");
    const filename = `${entry.className}.${entry.methodName}.java`.replaceAll("$", "_");
    return this.vscode.Uri.parse(
      `${GAUGE_DEPENDENCY_SCHEME}:/${encodeURIComponent(filename)}?${identity}`,
    );
  }

  async findDefinitions(root, normalizedSteps) {
    if (this.disposed) {
      return [];
    }
    let index;
    try {
      index = await this.refresh(root);
    } catch (error) {
      if (this.disposed) {
        return [];
      }
      throw error;
    }
    if (this.disposed || !index) {
      return [];
    }
    if (this.indices.get(root) !== index) {
      return this.findDefinitions(root, normalizedSteps);
    }
    const definitions = [];
    const pendingContents = [];
    const pendingDeclarations = [];
    const seen = new Set();
    for (const normalized of normalizedSteps || []) {
      for (const entry of index.entriesByTemplate.get(normalized) || []) {
        const identity = dependencyIdentity(entry);
        if (seen.has(identity)) {
          continue;
        }
        seen.add(identity);
        const uri = this.uriFor(entry, root);
        const declaration = declarationFor(entry);
        pendingDeclarations.push({ root, uri, identity, artifact: entry.artifact, physicalArtifact: canonicalFilePath(entry.artifact) });
        pendingContents.push([uri.toString(), declaration.content]);
        pendingContents.push([uri.query, declaration.content]);
        definitions.push({
          range: createRange(
            this.vscode,
            declaration.methodLine,
            declaration.methodStart,
            declaration.methodEnd,
          ),
          uri,
        });
      }
    }
    if (this.disposed) {
      return [];
    }
    if (this.indices.get(root) !== index) {
      return this.findDefinitions(root, normalizedSteps);
    }
    for (const tracked of pendingDeclarations) this.declarations.set(tracked.uri.toString(), tracked);
    for (const [key, content] of pendingContents) {
      this.contents.set(key, content);
    }
    return definitions;
  }

  content(uri) {
    if (this.disposed) {
      return "Dependency step declaration is unavailable.";
    }
    return this.contents.get(uri && uri.toString())
      || this.contents.get(uri && uri.query)
      || "Dependency step declaration is unavailable.";
  }

  register() {
    if (this.disposed) {
      return { dispose() {} };
    }
    const workspace = this.vscode.workspace || {};
    const disposables = [];
    let registrationDisposed = false;
    if (this.sourceScope?.onDidChange) disposables.push(this.sourceScope.onDidChange(() => this.invalidate()));
    if (
      this.projectEnvironmentService
      && typeof this.projectEnvironmentService.onDidInvalidate === "function"
    ) {
      disposables.push(this.projectEnvironmentService.onDidInvalidate((root) => {
        this.invalidate(root);
      }));
    }
    if (typeof workspace.registerTextDocumentContentProvider === "function") {
      disposables.push(workspace.registerTextDocumentContentProvider(GAUGE_DEPENDENCY_SCHEME, {
        provideTextDocumentContent: (uri) => this.content(uri),
        ...(this.contentChanges ? { onDidChange: this.contentChanges.event } : {}),
      }));
    }
    return {
      dispose: () => {
        if (registrationDisposed) {
          return;
        }
        registrationDisposed = true;
        this.dispose();
        for (const disposable of disposables) {
          if (disposable && typeof disposable.dispose === "function") {
            disposable.dispose();
          }
        }
      },
    };
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.clearBinaryWatches();
    this.invalidationListeners.clear();
    this.generation += 1;
    this.globalInvalidationGeneration += 1;
    this.rootInvalidationGenerations.clear();
    this.contents.clear();
    this.declarations.clear();
    this.contentChanges?.dispose();
    this.indices.clear();
    this.pending.clear();
  }
}

module.exports = {
  DependencyStepIndex,
  GAUGE_DEPENDENCY_SCHEME,
  normalizeStepTemplate,
  parseDependencyClass,
  scanJarArchive,
  scanClassDirectory,
};
