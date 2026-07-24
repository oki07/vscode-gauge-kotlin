"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { GradleProject } = require("../../src/project/gradleProject");

const gradleCommand = process.env.GAUGE_LIFECYCLE_GRADLE;
const gaugeCommand = process.env.GAUGE_LIFECYCLE_GAUGE || "gauge";
const fixtureRoot = path.resolve(
  __dirname,
  "../fixtures/selected-scenario-lifecycle",
);
const expectedLifecycle = [
  "BeforeSuite",
  "BeforeSpec",
  "BeforeScenario",
  "BeforeStep",
  "Step",
  "AfterStep",
  "AfterScenario",
  "AfterSpec",
  "AfterSuite",
];

function selectedScenarioLine(specification) {
  const lines = fs.readFileSync(specification, "utf8").split(/\r?\n/);
  const index = lines.indexOf("## Selected scenario");
  assert.notEqual(index, -1, "Selected scenario heading is missing.");
  return index + 1;
}

function commandOutput(result) {
  return [result.stdout, result.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();
}

test("selected Gradle scenario executes every Gauge lifecycle hook in order", {
  skip: gradleCommand ? false : "Set GAUGE_LIFECYCLE_GRADLE to run the Gauge integration fixture.",
  timeout: 180_000,
}, () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gauge-lifecycle-"));
  const projectRoot = path.join(temporaryRoot, "project");
  const lifecycleLog = path.join(temporaryRoot, "lifecycle.log");

  try {
    fs.cpSync(fixtureRoot, projectRoot, { recursive: true });
    const project = new GradleProject(projectRoot, { Language: "kotlin" }, {
      fileSystem: {
        existsSync(filename) {
          return filename === path.join(projectRoot, "gradlew")
            || fs.existsSync(filename);
        },
      },
    });
    const executionEnvironment = project.executionEnvs({
      gradleCommand() {
        return { command: gradleCommand };
      },
    });

    assert.ok(executionEnvironment);
    assert.doesNotMatch(executionEnvironment.gauge_custom_classpath, /\r|\n/);
    assert.match(
      executionEnvironment.gauge_custom_classpath,
      /hooks[/\\]build[/\\]classes[/\\]java[/\\]test/,
    );

    const specification = path.join(projectRoot, "specs", "lifecycle.spec");
    const selector = `${specification}:${selectedScenarioLine(specification)}`;
    const result = childProcess.spawnSync(gaugeCommand, [
      "run",
      "--hide-suggestion",
      "--simple-console",
      selector,
    ], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ...executionEnvironment,
        GAUGE_LIFECYCLE_LOG: lifecycleLog,
      },
      timeout: 60_000,
    });

    assert.ifError(result.error);
    assert.equal(result.status, 0, commandOutput(result));
    assert.deepEqual(
      fs.readFileSync(lifecycleLog, "utf8").trim().split(/\r?\n/),
      expectedLifecycle,
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
