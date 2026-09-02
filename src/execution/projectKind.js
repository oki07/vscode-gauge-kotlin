"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { GradleProject } = require("../project/gradleProject");
const { MavenProject } = require("../project/mavenProject");

// Which execution path a project root takes. The Test Explorer asks it to
// decide whether a multi-item selection may become one run, and the executor
// asks it to choose the arguments that run gets; a second copy of the rule
// that answers differently batches a selection the run cannot carry, because a
// build-tool run puts its targets in ONE property value.

function detectProjectKind(projectRoot, fileSystem, pathModule) {
  const files = fileSystem || nodeFs;
  const paths = pathModule || nodePath;
  const exists = (relativePath) => (
    typeof files.existsSync === "function"
    && files.existsSync(paths.join(projectRoot, relativePath))
  );

  // A root build script, matching GRADLE_BUILD_FILES in
  // src/project/projectFactory.js. A wrapper script alone - a multi-module repo
  // whose root holds only settings.gradle.kts - is a plain Gauge project there,
  // so accepting it here handed Gradle plugin arguments to a command that cannot
  // use them.
  if (exists("build.gradle.kts") || exists("build.gradle")) {
    return "gradle";
  }
  if (exists("pom.xml")) {
    return "maven";
  }
  return "gauge";
}

function projectKindFromProject(project) {
  if (project && typeof project.executionKind === "function") {
    return project.executionKind();
  }
  if (project instanceof MavenProject) {
    return "maven";
  }
  if (project instanceof GradleProject) {
    return "gradle";
  }
  return undefined;
}

function projectForRoot(projectFactory, projectRoot) {
  if (!projectRoot || !projectFactory || typeof projectFactory.get !== "function") {
    return undefined;
  }
  try {
    return projectFactory.get(projectRoot);
  } catch (_error) {
    return undefined;
  }
}

function executionKindForRoot(projectFactory, projectRoot, options = {}) {
  if (!projectRoot) {
    return undefined;
  }
  return projectKindFromProject(projectForRoot(projectFactory, projectRoot))
    || detectProjectKind(projectRoot, options.fileSystem, options.pathModule);
}

module.exports = {
  detectProjectKind,
  executionKindForRoot,
  projectForRoot,
  projectKindFromProject,
};
