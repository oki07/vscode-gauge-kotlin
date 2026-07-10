const assert = require("node:assert/strict");
const test = require("node:test");

test("buildRunArgs.forGauge ignores other args when failed flag is set", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.equal(
    buildRunArgs.forGauge("my.spec:123", { failed: true, tags: "should be ignored" }).join(" "),
    "run --failed",
  );
});

test("buildRunArgs.forGauge ignores other args when repeat flag is set", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.equal(
    buildRunArgs.forGauge("my.spec:123", { repeat: true, tags: "should be ignored" }).join(" "),
    "run --repeat",
  );
});

test("buildRunArgs.forGauge keeps Test UI flags for failed and repeat runs", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.deepEqual(
    buildRunArgs.forGauge("my.spec:123", {
      failed: true,
      "hide-suggestion": true,
      "machine-readable": true,
      tags: "should be ignored",
    }),
    ["run", "--failed", "--hide-suggestion", "--machine-readable"],
  );
  assert.deepEqual(
    buildRunArgs.forGauge("my.spec:123", {
      repeat: true,
      "hide-suggestion": true,
      "machine-readable": true,
      tags: "should be ignored",
    }),
    ["run", "--repeat", "--hide-suggestion", "--machine-readable"],
  );
});

test("buildRunArgs.forGauge keeps Gauge rerun override flags", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.deepEqual(
    buildRunArgs.forGauge("my.spec:123", {
      failed: true,
      verbose: true,
      "simple-console": true,
      dir: "envs/dev",
      "log-level": "debug",
      tags: "should be ignored",
      parallel: true,
    }),
    [
      "run",
      "--failed",
      "--verbose",
      "--simple-console",
      "--dir",
      "envs/dev",
      "--log-level",
      "debug",
    ],
  );
  assert.deepEqual(
    buildRunArgs.forGauge("my.spec:123", {
      repeat: true,
      verbose: true,
      "log-level": "error",
      tags: "should be ignored",
    }),
    ["run", "--repeat", "--verbose", "--log-level", "error"],
  );
});

test("buildRunArgs.forGauge formats standard run options", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.equal(
    buildRunArgs.forGauge("my.spec:123", {
      tags: "foo bar",
      n: 3,
      env: ["a", "b", "c"],
      parallel: true,
      failed: null,
      repeat: false,
      "retry-only": null,
    }).join(" "),
    "run --hide-suggestion --tags foo bar --n 3 --env a,b,c --parallel my.spec:123",
  );
});

test("buildRunArgs omits invalid parallel node counts", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.deepEqual(
    buildRunArgs.forGauge("my.spec:123", {
      parallel: true,
      n: "two",
    }),
    ["run", "--hide-suggestion", "--parallel", "my.spec:123"],
  );
  assert.equal(
    buildRunArgs.forGradle("my.spec:123", {
      parallel: true,
      n: "two",
    }).join(" "),
    "clean gauge -PinParallel=true -PadditionalFlags=--hide-suggestion --simple-console -PspecsDir=my.spec:123",
  );
  assert.equal(
    buildRunArgs.forMaven("my.spec:123", {
      parallel: true,
      n: "two",
    }).join(" "),
    "-q clean compile test-compile gauge:execute -DinParallel=true -Dflags=--hide-suggestion,--simple-console -DspecsDir=my.spec:123",
  );
});

test("buildRunArgs.forGauge preserves boolean sort launch compatibility", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.deepEqual(
    buildRunArgs.forGauge(null, { sort: true }),
    ["run", "--hide-suggestion", "--simple-console", "--sort"],
  );
  assert.deepEqual(
    buildRunArgs.forGauge(null, { sort: "random", "random-seed": 4 }),
    ["run", "--hide-suggestion", "--simple-console", "--sort", "random", "--random-seed", "4"],
  );
});

test("buildRunArgs.forGauge appends launch args before the spec target", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.deepEqual(
    buildRunArgs.forGauge("my.spec:123", {
      args: ["--custom", "value"],
      tags: "smoke",
    }),
    [
      "run",
      "--hide-suggestion",
      "--simple-console",
      "--tags",
      "smoke",
      "--custom",
      "value",
      "my.spec:123",
    ],
  );
});

test("buildRunArgs.forGauge appends multiple spec targets", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.deepEqual(
    buildRunArgs.forGauge(["a.spec", "features"], { tags: "smoke" }),
    [
      "run",
      "--hide-suggestion",
      "--simple-console",
      "--tags",
      "smoke",
      "a.spec",
      "features",
    ],
  );
});

test("buildRunArgs.forGauge omits simple-console when parallel flag is set", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.equal(
    buildRunArgs.forGauge("my.spec:123", { parallel: true }).join(" "),
    "run --hide-suggestion --parallel my.spec:123",
  );
});

test("buildRunArgs.forGauge allows default flags to be unset", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.equal(
    buildRunArgs.forGauge(null, { "hide-suggestion": false, "simple-console": false }).join(" "),
    "run",
  );
});

test("buildRunArgs.forGauge preserves explicit install plugin false option", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.deepEqual(
    buildRunArgs.forGauge("my.spec", { "install-plugins": false }),
    [
      "run",
      "--hide-suggestion",
      "--simple-console",
      "--install-plugins=false",
      "my.spec",
    ],
  );
});

test("buildRunArgs.forGradle ignores other args when failed flag is set", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.equal(
    buildRunArgs.forGradle("my.spec:123", { failed: true }).join(" "),
    "clean gauge -PadditionalFlags=--failed",
  );
});

test("buildRunArgs.forGradle ignores other args when repeat flag is set", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.equal(
    buildRunArgs.forGradle("my.spec:123", { repeat: true }).join(" "),
    "clean gauge -PadditionalFlags=--repeat",
  );
});

test("buildRunArgs.forGradle keeps Test UI flags for failed and repeat runs", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.equal(
    buildRunArgs.forGradle("my.spec:123", {
      failed: true,
      "hide-suggestion": true,
      "machine-readable": true,
      tags: "should be ignored",
    }).join(" "),
    "clean gauge -PadditionalFlags=--failed --hide-suggestion --machine-readable",
  );
  assert.equal(
    buildRunArgs.forGradle("my.spec:123", {
      repeat: true,
      "hide-suggestion": true,
      "machine-readable": true,
      tags: "should be ignored",
    }).join(" "),
    "clean gauge -PadditionalFlags=--repeat --hide-suggestion --machine-readable",
  );
});

test("buildRunArgs.forGradle forwards Gauge rerun override flags", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.equal(
    buildRunArgs.forGradle("my.spec:123", {
      failed: true,
      verbose: true,
      "simple-console": true,
      dir: "envs/dev",
      "log-level": "debug",
      tags: "should be ignored",
    }).join(" "),
    "clean gauge -PadditionalFlags=--failed --verbose --simple-console --dir envs/dev --log-level debug",
  );
});

test("buildRunArgs.forGradle formats standard run options", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.equal(
    buildRunArgs.forGradle("my.spec:123", {
      tags: "foo bar",
      env: ["a", "b", "c"],
      parallel: true,
      n: 3,
      failed: null,
      repeat: false,
      "retry-only": null,
    }).join(" "),
    "clean gauge -PinParallel=true -Pnodes=3 -Ptags=foo bar -Penv=a,b,c -PadditionalFlags=--hide-suggestion --simple-console -PspecsDir=my.spec:123",
  );
});

test("buildRunArgs.forGradle accepts a single environment name", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.equal(
    buildRunArgs.forGradle("my.spec:123", { env: "ci" }).join(" "),
    "clean gauge -Penv=ci -PadditionalFlags=--hide-suggestion --simple-console -PspecsDir=my.spec:123",
  );
});

test("buildRunArgs.forGradle forwards valued Gauge flags through additionalFlags", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.equal(
    buildRunArgs.forGradle("my.spec", {
      "retry-only": "smoke",
      "table-rows": "1-3",
      group: 2,
      verbose: true,
    }).join(" "),
    "clean gauge -PadditionalFlags=--hide-suggestion --simple-console --retry-only smoke --table-rows 1-3 --group 2 --verbose -PspecsDir=my.spec",
  );
});

test("buildRunArgs.forGradle forwards launch args through additionalFlags", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.equal(
    buildRunArgs.forGradle("my.spec", {
      args: ["--custom", "value"],
    }).join(" "),
    "clean gauge -PadditionalFlags=--hide-suggestion --simple-console --custom value -PspecsDir=my.spec",
  );
});

test("buildRunArgs.forGradle joins multiple spec targets with the Gauge delimiter", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.equal(
    buildRunArgs.forGradle(["specs/a.spec", "specs/features"], { tags: "smoke" }).join(" "),
    "clean gauge -Ptags=smoke -PadditionalFlags=--hide-suggestion --simple-console -PspecsDir=specs/a.spec||specs/features",
  );
});

test("buildRunArgs.forGradle allows default flags to be unset", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.equal(
    buildRunArgs.forGradle(null, { "hide-suggestion": false, "simple-console": false }).join(" "),
    "clean gauge",
  );
});

test("buildRunArgs.forGradle preserves explicit install plugin false option", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.equal(
    buildRunArgs.forGradle("my.spec", { "install-plugins": false }).join(" "),
    "clean gauge -PadditionalFlags=--hide-suggestion --simple-console --install-plugins=false -PspecsDir=my.spec",
  );
});

test("buildRunArgs.forMaven ignores other args when failed flag is set", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.equal(
    buildRunArgs.forMaven("my.spec:123", { failed: true }).join(" "),
    "-q clean compile test-compile gauge:execute -Dflags=--failed",
  );
});

test("buildRunArgs.forMaven ignores other args when repeat flag is set", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.equal(
    buildRunArgs.forMaven("my.spec:123", { repeat: true }).join(" "),
    "-q clean compile test-compile gauge:execute -Dflags=--repeat",
  );
});

test("buildRunArgs.forMaven keeps Test UI flags for failed and repeat runs", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.equal(
    buildRunArgs.forMaven("my.spec:123", {
      failed: true,
      "hide-suggestion": true,
      "machine-readable": true,
      tags: "should be ignored",
    }).join(" "),
    "-q clean compile test-compile gauge:execute -Dflags=--failed,--hide-suggestion,--machine-readable",
  );
  assert.equal(
    buildRunArgs.forMaven("my.spec:123", {
      repeat: true,
      "hide-suggestion": true,
      "machine-readable": true,
      tags: "should be ignored",
    }).join(" "),
    "-q clean compile test-compile gauge:execute -Dflags=--repeat,--hide-suggestion,--machine-readable",
  );
});

test("buildRunArgs.forMaven forwards Gauge rerun override flags", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.equal(
    buildRunArgs.forMaven("my.spec:123", {
      repeat: true,
      verbose: true,
      "simple-console": true,
      dir: "envs/dev",
      "log-level": "debug",
      tags: "should be ignored",
    }).join(" "),
    "-q clean compile test-compile gauge:execute -Dflags=--repeat,--verbose,--simple-console,--dir,envs/dev,--log-level,debug",
  );
});

test("buildRunArgs.forMaven formats standard run options", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.equal(
    buildRunArgs.forMaven("my.spec:123", {
      tags: "foo bar",
      env: ["a", "b", "c"],
      parallel: true,
      n: 3,
      failed: null,
      repeat: false,
      "retry-only": null,
    }).join(" "),
    "-q clean compile test-compile gauge:execute -DinParallel=true -Dnodes=3 -Dtags=foo bar -Denv=a,b,c -Dflags=--hide-suggestion,--simple-console -DspecsDir=my.spec:123",
  );
});

test("buildRunArgs.forMaven accepts a single environment name", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.equal(
    buildRunArgs.forMaven("my.spec:123", { env: "ci" }).join(" "),
    "-q clean compile test-compile gauge:execute -Denv=ci -Dflags=--hide-suggestion,--simple-console -DspecsDir=my.spec:123",
  );
});

test("buildRunArgs.forMaven forwards valued Gauge flags through flags", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.equal(
    buildRunArgs.forMaven("my.spec", {
      "retry-only": "smoke",
      "table-rows": "1-3",
      group: 2,
      verbose: true,
    }).join(" "),
    "-q clean compile test-compile gauge:execute -Dflags=--hide-suggestion,--simple-console,--retry-only,smoke,--table-rows,1-3,--group,2,--verbose -DspecsDir=my.spec",
  );
});

test("buildRunArgs.forMaven forwards launch args through flags", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.equal(
    buildRunArgs.forMaven("my.spec", {
      args: ["--custom", "value"],
    }).join(" "),
    "-q clean compile test-compile gauge:execute -Dflags=--hide-suggestion,--simple-console,--custom,value -DspecsDir=my.spec",
  );
});

test("buildRunArgs.forMaven joins multiple spec targets with the Gauge delimiter", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.equal(
    buildRunArgs.forMaven(["specs/a.spec", "specs/features"], { tags: "smoke" }).join(" "),
    "-q clean compile test-compile gauge:execute -Dtags=smoke -Dflags=--hide-suggestion,--simple-console -DspecsDir=specs/a.spec||specs/features",
  );
});

test("buildRunArgs.forMaven allows default flags to be unset", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.equal(
    buildRunArgs.forMaven(null, { "hide-suggestion": false, "simple-console": false }).join(" "),
    "-q clean compile test-compile gauge:execute",
  );
});

test("buildRunArgs.forMaven preserves explicit install plugin false option", () => {
  const { buildRunArgs } = require("../../src/execution/runArgs");

  assert.equal(
    buildRunArgs.forMaven("my.spec", { "install-plugins": false }).join(" "),
    "-q clean compile test-compile gauge:execute -Dflags=--hide-suggestion,--simple-console,--install-plugins=false -DspecsDir=my.spec",
  );
});

test("extractGaugeRunOption picks first gauge test entry and removes launch attributes", () => {
  const { extractGaugeRunOption } = require("../../src/execution/runArgs");

  const configs = [
    { type: "foo", name: "1", request: "launch", tags: "fail" },
    { type: "bar", name: "2", request: "test", tags: "fail" },
    { type: "gauge", name: "3", request: "attach", tags: "fail" },
    {
      type: "gauge",
      name: "4",
      request: "test",
      tags: "hit",
      unknown: "attributes are also available",
    },
    { type: "gauge", name: "5", request: "test", tags: "fail" },
  ];

  assert.deepEqual(extractGaugeRunOption(configs), {
    tags: "hit",
    unknown: "attributes are also available",
  });
});

test("extractGaugeRunOption excludes process execution attributes", () => {
  const { extractGaugeRunOption } = require("../../src/execution/runArgs");

  assert.deepEqual(extractGaugeRunOption([
    {
      type: "gauge",
      request: "test",
      name: "Gauge",
      cwd: "tools/runner",
      processEnv: { FEATURE: "enabled" },
      args: ["--custom", "value"],
      tags: "smoke",
    },
  ]), {
    tags: "smoke",
  });
});

test("extractGaugeExecutionOption returns launch process execution attributes", () => {
  const { extractGaugeExecutionOption } = require("../../src/execution/runArgs");

  assert.deepEqual(extractGaugeExecutionOption([
    {
      type: "gauge",
      request: "test",
      name: "Gauge",
      cwd: "tools/runner",
      processEnv: {
        FEATURE: "enabled",
        IGNORED: 1,
      },
      args: ["--custom", "value"],
      tags: "smoke",
    },
  ]), {
    args: ["--custom", "value"],
    cwd: "tools/runner",
    processEnv: { FEATURE: "enabled" },
  });
});

test("extractGaugeRunOption returns empty object when no gauge test entry is found", () => {
  const { extractGaugeRunOption } = require("../../src/execution/runArgs");

  const configs = [
    { type: "foo", name: "1", request: "launch" },
    { type: "bar", name: "2", request: "test" },
    { type: "gauge", name: "3", request: "attach" },
  ];

  assert.deepEqual(extractGaugeRunOption(configs), {});
});

test("extractGaugeRunOption returns empty object for null", () => {
  const { extractGaugeRunOption } = require("../../src/execution/runArgs");

  assert.deepEqual(extractGaugeRunOption(null), {});
});
