"use strict";

const os = require("node:os");
const { performance } = require("node:perf_hooks");

const { findJavaStepFunctions, findStepFunctions } = require("../src/stepDiagnostics");

const MAX_DOUBLING_RATIO = 3;
const SAMPLE_COUNT = 7;

function kotlinStepSource(size) {
  return [
    "import com.thoughtworks.gauge.Step",
    ...Array.from({ length: size }, (_value, index) => [
      `class Steps${index} {`,
      `  @Step(\"Step ${index}\")`,
      `  fun step${index}() {}`,
      "}",
    ].join("\n")),
  ].join("\n");
}

function scopedConstantStepSource(size) {
  return [
    "import com.thoughtworks.gauge.Step",
    ...Array.from({ length: size }, (_value, index) => [
      `class Steps${index} {`,
      "  companion object {",
      `    const val STEP_${index} = \"Step ${index}\"`,
      "  }",
      `  @Step(STEP_${index})`,
      `  fun step${index}() {}`,
      "}",
    ].join("\n")),
  ].join("\n");
}

function javaConstantStepSource(size) {
  return [
    "import com.thoughtworks.gauge.Step;",
    ...Array.from({ length: size }, (_value, index) => [
      `class Steps${index} {`,
      `  static final String STEP_${index} = \"Step ${index}\";`,
      `  @Step(STEP_${index})`,
      `  void step${index}() {}`,
      "}",
    ].join("\n")),
  ].join("\n");
}

const SCENARIOS = [
  {
    name: "literal-steps",
    parser: findStepFunctions,
    sizes: [80, 160, 320],
    source: kotlinStepSource,
    stepsPerSample: 1920,
    warmups: 50,
  },
  {
    name: "scoped-constant-steps",
    parser: findStepFunctions,
    sizes: [40, 80, 160],
    source: scopedConstantStepSource,
    stepsPerSample: 320,
    warmups: 20,
  },
  {
    name: "java-constant-steps",
    parser: findJavaStepFunctions,
    sizes: [80, 160, 320],
    source: javaConstantStepSource,
    stepsPerSample: 1920,
    warmups: 50,
  },
];

function median(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function measure(scenario, size) {
  const text = scenario.source(size);
  const repetitions = Math.ceil(scenario.stepsPerSample / size);
  for (let warmup = 0; warmup < scenario.warmups; warmup += 1) {
    scenario.parser(text);
  }
  const samples = [];
  for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
    global.gc();
    const started = performance.now();
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      const entries = scenario.parser(text);
      if (entries.length !== size) {
        throw new Error(`expected ${size} Step entries, received ${entries.length}`);
      }
    }
    samples.push((performance.now() - started) / repetitions);
  }
  return {
    bytes: Buffer.byteLength(text),
    medianMs: median(samples),
    repetitions,
    size,
  };
}

function main() {
  const scenarios = SCENARIOS.map((scenario) => {
    const results = scenario.sizes.map((size) => measure(scenario, size));
    return {
      doublingRatios: results.slice(1).map((result, index) => (
        result.medianMs / results[index].medianMs
      )),
      name: scenario.name,
      results,
      stepsPerSample: scenario.stepsPerSample,
      warmups: scenario.warmups,
    };
  });
  process.stdout.write(`${JSON.stringify({
    machine: {
      arch: os.arch(),
      cpu: (os.cpus()[0] && os.cpus()[0].model) || "unknown",
      node: process.version,
      platform: os.platform(),
    },
    maxDoublingRatio: MAX_DOUBLING_RATIO,
    samples: SAMPLE_COUNT,
    scenarios,
  }, null, 2)}\n`);
  for (const scenario of scenarios) {
    for (const ratio of scenario.doublingRatios) {
      if (ratio >= MAX_DOUBLING_RATIO) {
        throw new Error(
          `${scenario.name} doubling ratio ${ratio.toFixed(3)} exceeds ${MAX_DOUBLING_RATIO}`,
        );
      }
    }
  }
}

main();
