const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");

// The Test Explorer decides whether a multi-item selection may be batched into
// one run, and the executor decides which arguments that run gets. Both answer
// the same question - which execution path does this project root take - and a
// disagreement runs only the first of the selected targets and reports nothing
// about the rest, because a build-tool run carries its targets in ONE property
// value (src/execution/runArgs.js joinedSpecTargets).
test("the Test Explorer and the executor resolve one execution kind per root", () => {
  const { executionKindForRoot } = require("../src/execution/projectKind");
  const { canBatchSpecificationTargets } = require("../src/testController");

  const root = "/workspace/gauge";
  const pathModule = path.posix;
  const gradleFileSystem = {
    existsSync(file) {
      return file === "/workspace/gauge/build.gradle.kts";
    },
  };
  const targets = ["/workspace/gauge/specs/a.spec", "/workspace/gauge/specs/b.spec"];

  // A root the project factory cannot resolve still runs through the build tool,
  // because the executor falls back to the build file on disk. The Test Explorer
  // has to see the same kind or it batches a selection that cannot be batched.
  const unresolved = { get() { return undefined; } };
  assert.equal(
    executionKindForRoot(unresolved, root, { fileSystem: gradleFileSystem, pathModule }),
    "gradle",
  );
  assert.equal(
    canBatchSpecificationTargets(
      targets,
      executionKindForRoot(unresolved, root, { fileSystem: gradleFileSystem, pathModule }),
    ),
    false,
  );

  // A resolved Gradle project runs through the Gauge CLI, which takes each
  // target as its own argument, so batching that selection is correct.
  const { GradleProject } = require("../src/project/gradleProject");
  const gradleProject = new GradleProject(root, { Language: "java" }, {
    fileSystem: gradleFileSystem,
    pathModule,
  });
  const resolved = { get() { return gradleProject; } };
  assert.equal(
    executionKindForRoot(resolved, root, { fileSystem: gradleFileSystem, pathModule }),
    "gauge",
  );
  assert.equal(
    canBatchSpecificationTargets(
      targets,
      executionKindForRoot(resolved, root, { fileSystem: gradleFileSystem, pathModule }),
    ),
    true,
  );

  // One target is never batched, whatever the kind.
  assert.equal(canBatchSpecificationTargets([targets[0]], "gauge"), false);
});
