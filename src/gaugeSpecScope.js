"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");

// Gauge reads Markdown as a specification only inside the directories named by
// `gauge_specs_dir`, a comma separated list of project relative paths that
// defaults to "specs" (references/gauge/util/util.go GetSpecDirs,
// references/gauge/env/env.go). `.spec` and `.cpt` are unambiguous and are
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
const DEFAULT_ENV_PROPERTIES = ["env", "default", "default.properties"];
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
  return String(value || "")
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\\([tnrf\\:= ])/g, (_match, character) => {
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

function propertiesValue(content, key) {
  const separators = new Set(["=", ":"]);
  for (const rawLine of String(content || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) {
      continue;
    }
    const explicitSeparator = firstUnescapedIndex(line, separators);
    const separator = explicitSeparator === -1 ? firstWhitespaceIndex(line) : explicitSeparator;
    if (separator === -1) {
      continue;
    }
    if (line.slice(0, separator).trim() !== key) {
      continue;
    }
    return unescapePropertyValue(line.slice(separator + 1).trim());
  }
  return undefined;
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

function configuredSpecDirs(options = {}) {
  const { projectRoot } = options;
  let configured = process.env[GAUGE_SPECS_DIR_PROPERTY];
  const fileSystem = options.fileSystem || nodeFs;
  const pathModule = options.pathModule || nodePath;
  if (!configured && projectRoot && typeof fileSystem.readFileSync === "function") {
    try {
      configured = propertiesValue(
        fileSystem.readFileSync(
          pathModule.join(projectRoot, ...DEFAULT_ENV_PROPERTIES),
          "utf8",
        ),
        GAUGE_SPECS_DIR_PROPERTY,
      );
    } catch (_error) {
      configured = undefined;
    }
  }
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
function isMarkdownGaugeSpecFile(file, options = {}) {
  if (!MARKDOWN_FILE_PATTERN.test(String(file || ""))) {
    return false;
  }
  return isMarkdownSpecPath(file, createMarkdownSpecScope({
    fileSystem: options.fileSystem,
    pathModule: options.pathModule,
    projectRoot: options.projectRoot !== undefined
      ? options.projectRoot
      : gaugeProjectRootForFile(file, options.projectFactory),
  }));
}

module.exports = {
  GAUGE_SPECS_DIRECTORY,
  GAUGE_SPECS_DIR_PROPERTY,
  configuredSpecDirs,
  createMarkdownSpecScope,
  gaugeProjectRootForFile,
  isMarkdownGaugeSpecFile,
  isMarkdownSpecPath,
  propertiesValue,
};
