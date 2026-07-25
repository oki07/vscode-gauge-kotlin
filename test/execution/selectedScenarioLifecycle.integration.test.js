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

const expectedTaggedLifecycle = [
  "aBeforeSuite",
  "zBeforeSuite",
  "BeforeSpecContext:Selected tagged lifecycle",
  "zBeforeSpec",
  "bTaggedBeforeSpec",
  "yTaggedBeforeSpec",
  "BeforeScenarioContext:Selected tagged scenario",
  "zBeforeScenario",
  "bAndBeforeScenario",
  "cOrBeforeScenario",
  "BeforeStepContext:Record the tagged lifecycle.",
  "zBeforeStep",
  "bAndBeforeStep",
  "cOrBeforeStep",
  "TaggedStep",
  "cOrAfterStep",
  "bAndAfterStep",
  "zAfterStep",
  "AfterStepContext:Record the tagged lifecycle.",
  "cOrAfterScenario",
  "bAndAfterScenario",
  "zAfterScenario",
  "AfterScenarioContext:Selected tagged scenario",
  "yTaggedAfterSpec",
  "bTaggedAfterSpec",
  "zAfterSpec",
  "AfterSpecContext:Selected tagged lifecycle",
  "zAfterSuite",
  "aAfterSuite",
];

function selectedScenarioLine(specification, scenarioHeading = "## Selected scenario") {
  const lines = fs.readFileSync(specification, "utf8").split(/\r?\n/);
  const index = lines.indexOf(scenarioHeading);
  assert.notEqual(index, -1, "Selected scenario heading is missing.");
  return index + 1;
}

function commandOutput(result) {
  return [result.stdout, result.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();
}

function executeLifecycleFixture({
  lifecycleCase = "baseline",
  scenarioHeading = "## Selected scenario",
  specificationName = "lifecycle.spec",
  gaugeArguments = [],
} = {}) {
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

    const specification = path.join(projectRoot, "specs", specificationName);
    const selector = `${specification}:${selectedScenarioLine(
      specification,
      scenarioHeading,
    )}`;
    const result = childProcess.spawnSync(gaugeCommand, [
      "run",
      "--hide-suggestion",
      "--simple-console",
      ...gaugeArguments,
      selector,
    ], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ...executionEnvironment,
        GAUGE_LIFECYCLE_CASE: lifecycleCase,
        GAUGE_LIFECYCLE_LOG: lifecycleLog,
      },
      timeout: 60_000,
    });

    return {
      events: fs.existsSync(lifecycleLog)
        ? fs.readFileSync(lifecycleLog, "utf8").trim().split(/\r?\n/).filter(Boolean)
        : [],
      result,
    };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

test("selected Gradle scenario executes every Gauge lifecycle hook in order", {
  skip: gradleCommand ? false : "Set GAUGE_LIFECYCLE_GRADLE to run the Gauge integration fixture.",
  timeout: 180_000,
}, () => {
  const { events, result } = executeLifecycleFixture();

  assert.ifError(result.error);
  assert.equal(result.status, 0, commandOutput(result));
  assert.deepEqual(events, expectedLifecycle);
});

test("selected scenario preserves Gauge Java tagged hook order and execution context", {
  skip: gradleCommand ? false : "Set GAUGE_LIFECYCLE_GRADLE to run the Gauge integration fixture.",
  timeout: 180_000,
}, () => {
  const { events, result } = executeLifecycleFixture({
    lifecycleCase: "tagged-order",
    scenarioHeading: "## Selected tagged scenario",
    specificationName: "tagged-lifecycle.spec",
  });

  assert.ifError(result.error);
  assert.equal(result.status, 0, commandOutput(result));
  assert.deepEqual(events, expectedTaggedLifecycle);
});

test("selected scenario runs matching cleanup hooks after before hook failures", {
  skip: gradleCommand ? false : "Set GAUGE_LIFECYCLE_GRADLE to run the Gauge integration fixture.",
  timeout: 180_000,
}, () => {
  const cases = [
    {
      lifecycleCase: "fail-before-suite",
      expected: ["BeforeSuite:first", "BeforeSuite:fail", "AfterSuite"],
    },
    {
      lifecycleCase: "fail-before-spec",
      expected: [
        "BeforeSuite",
        "BeforeSpec:first",
        "BeforeSpec:fail",
        "AfterSpec",
        "AfterSuite",
      ],
    },
    {
      lifecycleCase: "fail-before-scenario",
      expected: [
        "BeforeSuite",
        "BeforeSpec",
        "BeforeScenario:first",
        "BeforeScenario:fail",
        "AfterScenario",
        "AfterSpec",
        "AfterSuite",
      ],
    },
    {
      lifecycleCase: "fail-before-step",
      expected: [
        "BeforeSuite",
        "BeforeSpec",
        "BeforeScenario",
        "BeforeStep:first",
        "BeforeStep:fail",
        "AfterStep",
        "AfterScenario",
        "AfterSpec",
        "AfterSuite",
      ],
    },
  ];

  for (const lifecycleCase of cases) {
    const { events, result } = executeLifecycleFixture({
      lifecycleCase: lifecycleCase.lifecycleCase,
      scenarioHeading: "## Selected failure scenario",
      specificationName: "failure-lifecycle.spec",
    });

    assert.ifError(result.error);
    assert.notEqual(result.status, 0, commandOutput(result));
    assert.deepEqual(events, lifecycleCase.expected);
  }
});

test("selected scenario preserves context and teardown lifecycle branches", {
  skip: gradleCommand ? false : "Set GAUGE_LIFECYCLE_GRADLE to run the Gauge integration fixture.",
  timeout: 180_000,
}, () => {
  const beforeContext = [
    "BeforeScenario",
    "BeforeStep:Prepare the selected fixture.",
  ];
  const teardown = [
    "BeforeStep:Clean the selected fixture.",
    "Teardown",
    "AfterStep:Clean the selected fixture.",
    "AfterScenario",
  ];
  const cases = [
    {
      lifecycleCase: "context-success",
      expectedStatus: 0,
      expected: [
        ...beforeContext,
        "Context",
        "AfterStep:Prepare the selected fixture.",
        "BeforeStep:Run the selected fixture body.",
        "Body",
        "AfterStep:Run the selected fixture body.",
        ...teardown,
      ],
    },
    {
      lifecycleCase: "context-failure",
      expectedStatus: 1,
      expected: [
        ...beforeContext,
        "Context:fail",
        "AfterStep:Prepare the selected fixture.",
        ...teardown,
      ],
    },
    {
      lifecycleCase: "body-failure",
      expectedStatus: 1,
      expected: [
        ...beforeContext,
        "Context",
        "AfterStep:Prepare the selected fixture.",
        "BeforeStep:Run the selected fixture body.",
        "Body:fail",
        "AfterStep:Run the selected fixture body.",
        ...teardown,
      ],
    },
  ];

  for (const lifecycleCase of cases) {
    const { events, result } = executeLifecycleFixture({
      lifecycleCase: lifecycleCase.lifecycleCase,
      scenarioHeading: "## Selected context scenario",
      specificationName: "context-lifecycle.spec",
    });

    assert.ifError(result.error);
    assert.equal(result.status, lifecycleCase.expectedStatus, commandOutput(result));
    assert.deepEqual(events, lifecycleCase.expected);
  }
});

test("selected scenario initializes Gauge Java data stores before matching hooks", {
  skip: gradleCommand ? false : "Set GAUGE_LIFECYCLE_GRADLE to run the Gauge integration fixture.",
  timeout: 180_000,
}, () => {
  const { events, result } = executeLifecycleFixture({
    lifecycleCase: "data-stores",
    scenarioHeading: "## Selected data store scenario",
    specificationName: "data-store-lifecycle.spec",
  });

  assert.ifError(result.error);
  assert.equal(result.status, 0, commandOutput(result));
  assert.deepEqual(events, [
    "BeforeSuite:suite=null,spec=null,scenario=null",
    "BeforeSpec:suite=suite,spec=null,scenario=suite-stale",
    "BeforeScenario:suite=suite,spec=spec,scenario=null",
    "Step:suite=suite,spec=spec,scenario=scenario",
    "AfterScenario:suite=suite,spec=spec,scenario=scenario",
    "AfterSpec:suite=suite,spec=spec,scenario=scenario",
    "AfterSuite:suite=suite,spec=spec,scenario=scenario",
  ]);
});

test("selected scenario preserves Gauge Java step skip cleanup lifecycle", {
  skip: gradleCommand ? false : "Set GAUGE_LIFECYCLE_GRADLE to run the Gauge integration fixture.",
  timeout: 180_000,
}, () => {
  const { events, result } = executeLifecycleFixture({
    lifecycleCase: "skip-step",
    scenarioHeading: "## Selected skip scenario",
    specificationName: "skip-lifecycle.spec",
  });

  assert.ifError(result.error);
  assert.equal(result.status, 0, commandOutput(result));
  assert.deepEqual(events, [
    "BeforeScenario",
    "BeforeStep:Prepare the skip fixture.",
    "Context",
    "AfterStep:Prepare the skip fixture.",
    "BeforeStep:Skip the selected scenario.",
    "Step:skip",
    "AfterStep:Skip the selected scenario.",
    "BeforeStep:Clean the skip fixture.",
    "Teardown",
    "AfterStep:Clean the skip fixture.",
    "AfterScenario",
  ]);
});

test("selected scenario repeats Gauge Java lifecycle for data table rows", {
  skip: gradleCommand ? false : "Set GAUGE_LIFECYCLE_GRADLE to run the Gauge integration fixture.",
  timeout: 180_000,
}, () => {
  const twoRows = [
    "BeforeSuite",
    "BeforeSpec",
    "BeforeScenario:scenario=null",
    "Step:one",
    "AfterScenario:scenario=set",
    "BeforeScenario:scenario=null",
    "Step:two",
    "AfterScenario:scenario=set",
    "AfterSpec",
    "AfterSuite",
  ];
  const cases = [
    {
      lifecycleCase: "spec-table",
      scenarioHeading: "## Selected spec table scenario",
      specificationName: "spec-table-lifecycle.spec",
      expected: twoRows,
    },
    {
      lifecycleCase: "scenario-table",
      scenarioHeading: "## Selected scenario table",
      specificationName: "scenario-table-lifecycle.spec",
      expected: twoRows,
    },
    {
      lifecycleCase: "spec-table",
      scenarioHeading: "## Selected spec table scenario",
      specificationName: "spec-table-lifecycle.spec",
      gaugeArguments: ["--table-rows", "2"],
      expected: [
        "BeforeSuite",
        "BeforeSpec",
        "BeforeScenario:scenario=null",
        "Step:two",
        "AfterScenario:scenario=set",
        "AfterSpec",
        "AfterSuite",
      ],
    },
  ];

  for (const lifecycleCase of cases) {
    const { events, result } = executeLifecycleFixture(lifecycleCase);

    assert.ifError(result.error);
    assert.equal(result.status, 0, commandOutput(result));
    assert.deepEqual(events, lifecycleCase.expected);
  }
});

test("selected scenario repeats Gauge Java scenario lifecycle for retries", {
  skip: gradleCommand ? false : "Set GAUGE_LIFECYCLE_GRADLE to run the Gauge integration fixture.",
  timeout: 180_000,
}, () => {
  const attempt = (number) => [
    "BeforeScenario:scenario=null",
    "BeforeStep:Prepare the retry fixture.",
    "Context",
    "AfterStep:Prepare the retry fixture.",
    "BeforeStep:Run the retry fixture.",
    `Step:attempt-${number}`,
    "AfterStep:Run the retry fixture.",
    "BeforeStep:Clean the retry fixture.",
    "Teardown",
    "AfterStep:Clean the retry fixture.",
    "AfterScenario:scenario=set",
  ];
  const cases = [
    {
      lifecycleCase: "retry-match",
      gaugeArguments: ["--max-retries-count", "2", "--retry-only", "retry-tag"],
      expectedStatus: 0,
      expected: [
        "BeforeSuite",
        "BeforeSpec",
        ...attempt(1),
        ...attempt(2),
        "AfterSpec",
        "AfterSuite",
      ],
    },
    {
      lifecycleCase: "retry-nonmatch",
      gaugeArguments: ["--max-retries-count", "2", "--retry-only", "missing-tag"],
      expectedStatus: 1,
      expected: [
        "BeforeSuite",
        "BeforeSpec",
        ...attempt(1),
        "AfterSpec",
        "AfterSuite",
      ],
    },
  ];

  for (const lifecycleCase of cases) {
    const { events, result } = executeLifecycleFixture({
      ...lifecycleCase,
      scenarioHeading: "## Selected retry scenario",
      specificationName: "retry-lifecycle.spec",
    });

    assert.ifError(result.error);
    assert.equal(result.status, lifecycleCase.expectedStatus, commandOutput(result));
    assert.deepEqual(events, lifecycleCase.expected);
  }
});
