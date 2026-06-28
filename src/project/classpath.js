"use strict";

const nodePath = require("node:path");

const GAUGE_CUSTOM_CLASSPATH = "gauge_custom_classpath";

function exists(fileSystem, filename) {
  return Boolean(fileSystem && typeof fileSystem.existsSync === "function" && fileSystem.existsSync(filename));
}

function isDirectory(fileSystem, filename) {
  if (!exists(fileSystem, filename)) {
    return false;
  }
  if (typeof fileSystem.statSync !== "function") {
    return !/\.jar$/i.test(filename);
  }
  try {
    const stat = fileSystem.statSync(filename);
    return Boolean(stat && typeof stat.isDirectory === "function" && stat.isDirectory());
  } catch (_error) {
    return false;
  }
}

function readDirectory(fileSystem, dirname) {
  if (!isDirectory(fileSystem, dirname) || typeof fileSystem.readdirSync !== "function") {
    return [];
  }
  try {
    return fileSystem.readdirSync(dirname);
  } catch (_error) {
    return [];
  }
}

function entryName(entry) {
  return typeof entry === "string" ? entry : entry.name;
}

function entryIsDirectory(fileSystem, filename, entry) {
  if (entry && typeof entry.isDirectory === "function") {
    return entry.isDirectory();
  }
  return isDirectory(fileSystem, filename);
}

function collectJarFiles(fileSystem, pathModule, dirname, visited = new Set()) {
  if (visited.has(dirname)) {
    return [];
  }
  visited.add(dirname);

  const jars = [];
  for (const entry of readDirectory(fileSystem, dirname)) {
    const name = entryName(entry);
    if (!name) {
      continue;
    }
    const filename = pathModule.join(dirname, name);
    if (entryIsDirectory(fileSystem, filename, entry)) {
      jars.push(...collectJarFiles(fileSystem, pathModule, filename, visited));
    } else if (/\.jar$/i.test(name)) {
      jars.push(filename);
    }
  }
  return jars;
}

function existingDirectories(fileSystem, pathModule, root, relativePaths) {
  return relativePaths
    .map((relativePath) => pathModule.join(root, relativePath))
    .filter((filename) => isDirectory(fileSystem, filename));
}

function pathDelimiter(pathModule) {
  return pathModule.delimiter || nodePath.delimiter;
}

module.exports = {
  GAUGE_CUSTOM_CLASSPATH,
  collectJarFiles,
  existingDirectories,
  pathDelimiter,
};
