"use strict";

const GAUGE_MANIFEST_FILE = "manifest.json";

function manifestPath(pathModule, root) {
  return pathModule.join(root, GAUGE_MANIFEST_FILE);
}

function readProjectManifest(fileSystem, pathModule, root) {
  const content = fileSystem.readFileSync(manifestPath(pathModule, root));
  return JSON.parse(content.toString());
}

function manifestLanguage(manifest) {
  return manifest && typeof manifest.Language === "string" ? manifest.Language : undefined;
}

function hasGaugeLanguage(manifest) {
  const language = manifestLanguage(manifest);
  return Boolean(language && language.trim());
}

function isGaugeProjectRoot(fileSystem, pathModule, root) {
  if (!root || !fileSystem || typeof fileSystem.existsSync !== "function") {
    return false;
  }
  if (!fileSystem.existsSync(manifestPath(pathModule, root))) {
    return false;
  }
  if (typeof fileSystem.readFileSync !== "function") {
    return false;
  }
  try {
    return hasGaugeLanguage(readProjectManifest(fileSystem, pathModule, root));
  } catch (_error) {
    return false;
  }
}

module.exports = {
  GAUGE_MANIFEST_FILE,
  hasGaugeLanguage,
  isGaugeProjectRoot,
  manifestLanguage,
  manifestPath,
  readProjectManifest,
};
