"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");

const { GAUGE_CUSTOM_CLASSPATH } = require("./project/classpath");

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
    this.fileSystem = options.fileSystem || nodeFs;
    this.pathModule = options.pathModule || nodePath;
    this.projectFactory = options.projectFactory;
    this.projectEnvironmentService = options.projectEnvironmentService;
    this.scanArchive = options.scanArchive || scanJarArchive;
    this.vscode = getVscode(options.vscode);
    this.classpathProvider = options.classpathProvider || ((root) => this.projectClasspath(root));
    this.contents = new Map();
    this.globalInvalidationGeneration = 0;
    this.indices = new Map();
    this.pending = new Map();
    this.rootInvalidationGenerations = new Map();
    this.generation = 0;
    this.disposed = false;
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
    const classpath = await this.classpathProvider(root);
    if (this.disposed) {
      return undefined;
    }
    const archives = [...new Set((Array.isArray(classpath) ? classpath : [])
      .filter((entry) => typeof entry === "string" && entry.toLowerCase().endsWith(".jar"))
      .filter((entry) => this.fileSystem.existsSync(entry)))];
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
      await this.scanArchiveSafely(archive, async (_fileName, data) => {
        if (this.disposed) {
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
            const normalized = normalizeStepTemplate(alias);
            if (!normalized) {
              continue;
            }
            if (!entriesByTemplate.has(normalized)) {
              entriesByTemplate.set(normalized, []);
            }
            entriesByTemplate.get(normalized).push(entry);
          }
        }
      });
      if (this.disposed) {
        return undefined;
      }
    }
    if (this.disposed) {
      return undefined;
    }
    return { classpathKey, entriesByTemplate };
  }

  async scanArchiveSafely(archive, visit) {
    try {
      await this.scanArchive(archive, visit);
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

  invalidate(root) {
    if (this.disposed) {
      return;
    }
    if (root) {
      this.rootInvalidationGenerations.set(
        root,
        (this.rootInvalidationGenerations.get(root) || 0) + 1,
      );
      this.indices.delete(root);
    } else {
      this.globalInvalidationGeneration += 1;
      this.rootInvalidationGenerations.clear();
      this.indices.clear();
    }
    this.generation += 1;
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
    const seen = new Set();
    for (const normalized of normalizedSteps || []) {
      for (const entry of index.entriesByTemplate.get(normalized) || []) {
        const identity = [entry.artifact, entry.className, entry.methodName, entry.descriptor].join("\n");
        if (seen.has(identity)) {
          continue;
        }
        seen.add(identity);
        const uri = this.uriFor(entry, root);
        const declaration = declarationFor(entry);
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
    this.generation += 1;
    this.globalInvalidationGeneration += 1;
    this.rootInvalidationGenerations.clear();
    this.contents.clear();
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
};
