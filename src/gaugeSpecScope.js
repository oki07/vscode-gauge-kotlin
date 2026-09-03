"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");

// Gauge reads Markdown as a specification only inside the directories named by
// `gauge_specs_dir`, a comma separated list of project relative paths that
// defaults to "specs" (getgauge/gauge/util/util.go GetSpecDirs,
// getgauge/gauge/env/env.go). `.spec` and `.cpt` are unambiguous and are
// recognised anywhere in the project; `.md` is not, and without this scope a
// README or CHANGELOG in a Gauge project gets Gauge colouring, folding, an
// outline, Run and Debug code lenses and undefined-step diagnostics.
//
// This is the one place the rule lives. The providers that answer for Markdown
// documents each carry their own copies of Gauge's *parsing* helpers on purpose,
// so that a change to one cannot silently alter another, but the question "is
// this file a specification at all" has to have a single answer or the same
// document is a specification for one provider and not for the next.

const GAUGE_SPECS_DIRECTORY = "specs";
const GAUGE_SPECS_DIR_PROPERTY = "gauge_specs_dir";
const GAUGE_SPEC_FILE_EXTENSIONS_PROPERTY = "gauge_spec_file_extensions";
const GAUGE_CONCEPTS_DIR_PROPERTY = "gauge_concepts_dir";
const MARKDOWN_EXTENSION = ".md";
const DEFAULT_ENV_DIRECTORY = "env";
const DEFAULT_ENV_NAME = "default";
const DEFAULT_ENV_FILE = "default.properties";
const PROPERTIES_EXTENSION = ".properties";
const GAUGE_ENV_DIR_PROPERTY = "gauge_env_dir";
const GAUGE_MANIFEST_FILE = "manifest.json";
const MARKDOWN_FILE_PATTERN = /\.md$/i;

function isEscapedAt(text, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function firstUnescapedIndex(line, characters) {
  for (let index = 0; index < line.length; index += 1) {
    if (characters.has(line[index]) && !isEscapedAt(line, index)) {
      return index;
    }
  }
  return -1;
}

function firstWhitespaceIndex(line) {
  for (let index = 0; index < line.length; index += 1) {
    if (/\s/.test(line[index])) {
      return index;
    }
  }
  return -1;
}

function unescapePropertyValue(value) {
  const text = String(value || "");
  if (/\\u(?![0-9a-fA-F]{4})/.test(text)) {
    // Gauge's Java-properties reader rejects an invalid Unicode literal rather
    // than treating its backslash as an ordinary escape marker.
    throw new Error("Invalid property Unicode literal");
  }
  return text
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\\(.)/g, (_match, character) => {
      if (character === "t") {
        return "\t";
      }
      if (character === "n") {
        return "\n";
      }
      if (character === "r") {
        return "\r";
      }
      if (character === "f") {
        return "\f";
      }
      return character;
    });
}

function trailingBackslashCount(value) {
  let count = 0;
  for (let index = value.length - 1; index >= 0 && value[index] === "\\"; index -= 1) {
    count += 1;
  }
  return count;
}

// Gauge loads Java properties through properties.MustLoadFiles. Its physical
// line continuation uses one unescaped trailing backslash, then discards the
// leading whitespace on the next line. Keep this normalization here so every
// property consumer shares Gauge's directory and extension values.
function propertyLines(content) {
  const lines = [];
  let joined = "";
  let continuing = false;
  for (const physicalLine of String(content || "").split(/\r?\n/)) {
    const line = continuing ? physicalLine.replace(/^[ \t\f]+/, "") : physicalLine;
    if (trailingBackslashCount(line) % 2 === 1) {
      joined += line.slice(0, -1);
      continuing = true;
      continue;
    }
    lines.push(joined + line);
    joined = "";
    continuing = false;
  }
  if (continuing) {
    lines.push(joined);
  }
  return lines;
}

function propertyValues(content) {
  const separators = new Set(["=", ":"]);
  const values = new Map();
  for (const rawLine of propertyLines(content)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) {
      continue;
    }
    const explicitSeparator = firstUnescapedIndex(line, separators);
    const separator = explicitSeparator === -1 ? firstWhitespaceIndex(line) : explicitSeparator;
    if (separator === -1) {
      continue;
    }
    const propertyKey = unescapePropertyValue(line.slice(0, separator).trim());
    if (propertyKey) {
      values.set(propertyKey, unescapePropertyValue(line.slice(separator + 1).trim()));
    }
  }
  return values;
}

function propertyValue(values, key) {
  const resolving = new Set();
  function resolve(name) {
    const value = values.get(name);
    if (value === undefined || resolving.has(name)) {
      return undefined;
    }
    resolving.add(name);
    let unresolvedReference = false;
    const resolved = value.replace(/\$\{(\w+)\}/g, (match, referencedKey) => {
      const referencedValue = resolve(referencedKey);
      if (referencedValue === undefined) {
        unresolvedReference = true;
        return match;
      }
      return referencedValue;
    });
    resolving.delete(name);
    return unresolvedReference ? undefined : resolved;
  }
  return resolve(key);
}

function propertiesValue(content, key) {
  return propertyValue(propertyValues(content), key);
}

function environmentPropertyFiles(fileSystem, pathModule, directory) {
  const files = [];
  function collect(currentDirectory) {
    let entries;
    try {
      entries = fileSystem.readdirSync(currentDirectory, { withFileTypes: true }) || [];
    } catch (_error) {
      return;
    }
    for (const entry of entries) {
      const name = String((entry && entry.name) || entry);
      const filePath = pathModule.join(currentDirectory, name);
      if (entry && typeof entry.isDirectory === "function") {
        if (entry.isDirectory()) {
          collect(filePath);
        } else if (name.toLowerCase().endsWith(PROPERTIES_EXTENSION)) {
          files.push(filePath);
        }
        continue;
      }
      if (name.toLowerCase().endsWith(PROPERTIES_EXTENSION)) {
        files.push(filePath);
      } else if (!name.includes(".")) {
        collect(filePath);
      }
    }
  }
  collect(directory);
  return files.sort();
}

function pathSegments(value) {
  return String(value || "")
    .split(/[\\/]/)
    .filter((segment) => segment !== "" && segment !== ".");
}

function startsWithSegments(segments, prefix) {
  return prefix.length > 0
    && segments.length >= prefix.length
    && prefix.every((segment, index) => segment === segments[index]);
}

// getgauge/gauge/env/env.go getEnvDir prefers the gauge_env_dir variable and
// otherwise takes EnvironmentDir from the project manifest, falling back to
// "env" (github.com/getgauge/common EnvDirectoryName).
// Read every time rather than memoized. A module level cache would answer with a
// stale directory after the manifest changed, and the read is one small file
// beside the properties read that follows it.
function environmentDirectory(fileSystem, pathModule, projectRoot) {
  const configured = process.env[GAUGE_ENV_DIR_PROPERTY];
  if (configured) {
    // Gauge rejects an absolute gauge_env_dir before loading any properties
    // (getgauge/gauge/env/env.go getEnvDir). Do not reinterpret it as a
    // project-relative path and decorate files from that unrelated location.
    if (typeof pathModule.isAbsolute === "function" && pathModule.isAbsolute(configured)) {
      return undefined;
    }
    return configured;
  }
  try {
    const manifest = JSON.parse(
      String(fileSystem.readFileSync(pathModule.join(projectRoot, GAUGE_MANIFEST_FILE), "utf8")),
    );
    if (manifest && typeof manifest.EnvironmentDir === "string" && manifest.EnvironmentDir.trim()) {
      return manifest.EnvironmentDir.trim();
    }
  } catch (_error) {
    // A missing or damaged manifest leaves the default directory name, which is
    // what Gauge itself falls back to.
  }
  return DEFAULT_ENV_DIRECTORY;
}

// Gauge loads every *.properties file in the environment directory, not just
// default.properties: getgauge/gauge/env/env.go loadEnvDir collects them with
// common.FindFilesInDir(envDirPath, isPropertiesFile) and merges them with
// properties.MustLoadFiles, where a later file wins. The bundled Kotlin template
// writes env/default/java.properties beside default.properties.
//
// Only the "default" environment is read. Selecting another one is the --env
// flag (getgauge/gauge/cmd/run.go environmentDefault "default"), which this
// extension never passes, so no other directory can be in force for a run it
// starts.
function propertiesValueFor(options, key) {
  const { projectRoot } = options;
  const fileSystem = options.fileSystem || nodeFs;
  const pathModule = options.pathModule || nodePath;
  if (!projectRoot || typeof fileSystem.readFileSync !== "function") {
    return undefined;
  }
  const environmentDir = environmentDirectory(fileSystem, pathModule, projectRoot);
  if (!environmentDir) {
    return undefined;
  }
  const directory = pathModule.join(
    projectRoot,
    environmentDir,
    DEFAULT_ENV_NAME,
  );
  const propertyFiles = typeof fileSystem.readdirSync === "function"
    ? environmentPropertyFiles(fileSystem, pathModule, directory)
    : [pathModule.join(directory, DEFAULT_ENV_FILE)];
  const values = new Map();
  for (const file of propertyFiles) {
    try {
      const entries = propertyValues(fileSystem.readFileSync(file, "utf8"));
      for (const [propertyKey, propertyValue] of entries) {
        values.set(propertyKey, propertyValue);
      }
    } catch (_error) {
      // An unreadable file is skipped, like a file Gauge cannot parse.
    }
  }
  return propertyValue(values, key);
}

function configuredSpecDirs(options = {}) {
  const configured = process.env[GAUGE_SPECS_DIR_PROPERTY]
    || propertiesValueFor(options, GAUGE_SPECS_DIR_PROPERTY);
  const directories = String(configured || "")
    .split(",")
    .map((entry) => pathSegments(entry.trim()))
    .filter((segments) => segments.length > 0);
  return directories.length > 0 ? directories : [[GAUGE_SPECS_DIRECTORY]];
}

// The scope resolves the configured directories lazily and memoizes them, so a
// caller that walks many candidates reads the project properties at most once
// and a caller that never sees Markdown never reads them at all.
function createMarkdownSpecScope(options = {}) {
  let directories;
  return {
    projectRoot: options.projectRoot,
    specDirs() {
      if (!directories) {
        directories = configuredSpecDirs(options);
      }
      return directories;
    },
  };
}

// When gauge_concepts_dir is set, Gauge reads concepts ONLY from those
// directories (getgauge/gauge/util/fileUtils.go GetConceptFiles returns early
// on GetConceptsPaths). Unset, it reads them from the whole project, which is
// what indexing every .cpt already matches.
function configuredConceptDirs(options = {}) {
  const configured = process.env[GAUGE_CONCEPTS_DIR_PROPERTY]
    || propertiesValueFor(options, GAUGE_CONCEPTS_DIR_PROPERTY);
  if (!configured) {
    return undefined;
  }
  const directories = String(configured)
    .split(",")
    .map((entry) => pathSegments(entry.trim()))
    .filter((segments) => segments.length > 0);
  return directories.length > 0 ? directories : undefined;
}

function isConceptPathInScope(file, options = {}) {
  const directories = configuredConceptDirs(options);
  if (!directories) {
    return true;
  }
  const projectRoot = options.projectRoot;
  const segments = pathSegments(file).slice(0, -1);
  if (!projectRoot) {
    return true;
  }
  const rootSegments = pathSegments(projectRoot);
  if (!startsWithSegments(segments, rootSegments)) {
    return true;
  }
  const relative = segments.slice(rootSegments.length);
  return directories.some((directory) => startsWithSegments(relative, directory));
}

function isMarkdownSpecPath(file, scope) {
  const directories = pathSegments(file).slice(0, -1);
  const projectRoot = scope && scope.projectRoot;
  if (!projectRoot) {
    // Without a project there is nothing to resolve the configured directories
    // against, so fall back to the default directory name.
    return directories.includes(GAUGE_SPECS_DIRECTORY);
  }
  const rootSegments = pathSegments(projectRoot);
  if (!startsWithSegments(directories, rootSegments)) {
    return directories.includes(GAUGE_SPECS_DIRECTORY);
  }
  const relative = directories.slice(rootSegments.length);
  return scope.specDirs().some((specDir) => startsWithSegments(relative, specDir));
}

function gaugeProjectRootForFile(file, projectFactory) {
  if (!file || !projectFactory || typeof projectFactory.getGaugeRootFromFilePath !== "function") {
    return undefined;
  }
  try {
    const root = projectFactory.getGaugeRootFromFilePath(file);
    if (!root) {
      return undefined;
    }
    if (typeof projectFactory.isGaugeProject === "function") {
      return projectFactory.isGaugeProject(root) === false ? undefined : root;
    }
    return root;
  } catch (_error) {
    return undefined;
  }
}

// Convenience for the providers that answer one document at a time.
// Gauge decides which extensions count as specifications from
// gauge_spec_file_extensions (getgauge/gauge/env/env.go
// GaugeSpecFileExtensions, default ".spec, .md"), and
// util.IsValidSpecExtension compares the lowercased extension against that
// list. Narrowing it to ".spec" is a project saying its Markdown is
// documentation, so no Gauge decoration belongs on it.
function markdownIsASpecExtension(options = {}) {
  const configured = process.env[GAUGE_SPEC_FILE_EXTENSIONS_PROPERTY]
    || propertiesValueFor(options, GAUGE_SPEC_FILE_EXTENSIONS_PROPERTY);
  if (!configured) {
    return true;
  }
  return String(configured)
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .includes(MARKDOWN_EXTENSION);
}

function isMarkdownGaugeSpecFile(file, options = {}) {
  if (!MARKDOWN_FILE_PATTERN.test(String(file || ""))) {
    return false;
  }
  const projectRoot = options.projectRoot !== undefined
    ? options.projectRoot
    : gaugeProjectRootForFile(file, options.projectFactory);
  if (!markdownIsASpecExtension({ ...options, projectRoot })) {
    return false;
  }
  return isMarkdownSpecPath(file, createMarkdownSpecScope({
    fileSystem: options.fileSystem,
    pathModule: options.pathModule,
    projectRoot,
  }));
}

module.exports = {
  GAUGE_SPECS_DIRECTORY,
  GAUGE_SPECS_DIR_PROPERTY,
  configuredConceptDirs,
  configuredSpecDirs,
  createMarkdownSpecScope,
  gaugeProjectRootForFile,
  isMarkdownGaugeSpecFile,
  isConceptPathInScope,
  isMarkdownSpecPath,
  markdownIsASpecExtension,
  propertiesValue,
  propertiesValueFor,
};
