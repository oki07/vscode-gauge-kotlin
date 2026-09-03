"use strict";

const commonLaunchAttributes = new Set([
  "type",
  "request",
  "name",
  "presentation",
  "preLaunchTask",
  "postDebugTask",
  "internalConsoleOptions",
  "debugServer",
  "serverReadyAction",
  "windows",
  "linux",
  "osx",
]);
const processExecutionAttributes = new Set([
  "args",
  "cwd",
  "processEnv",
]);
// Exactly getgauge/gauge/cmd/run.go overrideRerunFlags. Gauge counts any other
// flag set alongside --failed or --repeat in handleConflictingParams and answers
// "Invalid Command. Usage: gauge run --failed", which exit() turns into
// os.Exit(1). hide-suggestion must not be in this list: because the Test UI
// always sets it, Run Failed and Run Repeat never ran anything.
const RERUN_FLAG_KEYS = [
  "machine-readable",
  "verbose",
  "simple-console",
  "dir",
  "log-level",
];
// getgauge/gauge/cmd/run.go sets NoOptDefVal only on --sort.
const NO_OPT_DEFAULT_FLAG_KEYS = new Set(["sort"]);
// getgauge/gauge/cmd/run.go registers these as repeatable string slices.
const REPEATABLE_FLAG_KEYS = new Set(["scenario"]);
const explicitFalseBooleanFlags = new Set([
  "install-plugins",
]);

function withoutCommonLaunchAttributes(input) {
  return Object.entries(input)
    .filter(([key]) => !commonLaunchAttributes.has(key) && !processExecutionAttributes.has(key))
    .reduce((output, [key, value]) => {
      output[key] = value;
      return output;
    }, {});
}

function gaugeRunConfiguration(configs) {
  if (!configs) {
    return {};
  }
  return configs.find((config) => (
    config.type === "gauge" && config.request === "test"
  )) || {};
}

function extractGaugeRunOption(configs) {
  return withoutCommonLaunchAttributes(gaugeRunConfiguration(configs));
}

function additionalArgs(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === "string");
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed.split(/\s+/) : [];
  }
  return [];
}

function processEnv(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.entries(value)
    .filter(([, entryValue]) => typeof entryValue === "string")
    .reduce((output, [key, entryValue]) => {
      output[key] = entryValue;
      return output;
    }, {});
}

function extractGaugeExecutionOption(configs) {
  const config = gaugeRunConfiguration(configs);
  const option = {};
  const args = additionalArgs(config.args);
  const env = processEnv(config.processEnv);
  if (args.length > 0) {
    option.args = args;
  }
  if (typeof config.cwd === "string" && config.cwd.trim()) {
    option.cwd = config.cwd.trim();
  }
  if (Object.keys(env).length > 0) {
    option.processEnv = env;
  }
  return option;
}

function flag(key) {
  return `--${key}`;
}

function flagTokens(key, value) {
  if (typeof value === "boolean") {
    if (!value && explicitFalseBooleanFlags.has(key)) {
      return [`${flag(key)}=false`];
    }
    return value ? [flag(key)] : [];
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    // An empty array is the default VS Code's launch.json IntelliSense inserts,
    // and emitting "--scenario \"\"" makes Gauge filter every scenario away.
    if (value.length === 0) {
      return [];
    }
    // pflag registers --scenario as a repeatable string slice
    // (getgauge/gauge/cmd/run.go), so a comma joined value reads as one
    // scenario heading and matches nothing.
    if (REPEATABLE_FLAG_KEYS.has(key)) {
      return value.flatMap((entry) => [flag(key), entry]);
    }
    return [flag(key), value.join(",")];
  }
  if (typeof value === "string" || typeof value === "number") {
    // A flag with a pflag NoOptDefVal must carry its value attached: pflag reads
    // a separated "--sort random" as --sort=alpha plus a positional "random",
    // which gauge then treats as a spec path
    // (getgauge/gauge/cmd/run.go:143-145).
    return NO_OPT_DEFAULT_FLAG_KEYS.has(key)
      ? [`${flag(key)}=${value}`]
      : [flag(key), `${value}`];
  }
  return [];
}

function rerunFlagTokens(key, option = {}) {
  const tokens = [flag(key)];
  for (const rerunKey of RERUN_FLAG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(option, rerunKey)) {
      tokens.push(...flagTokens(rerunKey, option[rerunKey]));
    }
  }
  return tokens;
}

function specTargets(spec) {
  if (Array.isArray(spec)) {
    return spec.filter((entry) => typeof entry === "string" && entry);
  }
  return spec ? [spec] : [];
}

// A build tool passes its targets as ONE property value, and Gauge accepts no
// delimiter inside a single path: verified against the real CLI, where
// `gauge run "specs/a.spec||specs/b.spec"` - and the same with a space or a
// comma - answers "Specs directory ... does not exist." while
// `gauge run specs/a.spec specs/b.spec` runs both. Gluing them produced a value
// that runs NOTHING, so the Test Explorer no longer batches for Gradle or Maven
// (canBatchSpecificationTargets) and only the first target can be honoured here.
function joinedSpecTargets(spec) {
  return specTargets(spec)[0] || "";
}

function joinedEnvironmentNames(env) {
  if (Array.isArray(env) && env.every((entry) => typeof entry === "string")) {
    return env.join(",");
  }
  if (typeof env === "string" || typeof env === "number") {
    return `${env}`;
  }
  return "";
}

function parallelNodeCount(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) ? `${value}` : undefined;
  }
  if (typeof value === "string" && /^[+-]?\d+$/.test(value)) {
    return value;
  }
  return undefined;
}

function buildGaugeArgs(spec, option = {}) {
  const args = ["run"];
  const launchArgs = additionalArgs(option.args);

  if (option.failed) {
    return args.concat(rerunFlagTokens("failed", option));
  }
  if (option.repeat) {
    return args.concat(rerunFlagTokens("repeat", option));
  }

  const merged = {
    "hide-suggestion": true,
    "simple-console": !option.parallel,
    ...option,
  };
  delete merged.args;
  if (merged.parallel && Object.prototype.hasOwnProperty.call(merged, "n")) {
    const nodes = parallelNodeCount(merged.n);
    if (nodes === undefined) {
      delete merged.n;
    } else {
      merged.n = nodes;
    }
  }

  for (const [key, value] of Object.entries(merged)) {
    args.push(...flagTokens(key, value));
  }

  args.push(...launchArgs);

  args.push(...specTargets(spec));

  return args;
}

function buildJavaRunArgs(spec, option = {}, prefix, additionalFlags) {
  const {
    args: launchArgs,
    failed,
    repeat,
    tags,
    parallel,
    n,
    env,
    ...rest
  } = {
    "hide-suggestion": true,
    "simple-console": true,
    ...option,
  };
  const prefixed = (value) => `${prefix}${value}`;
  const args = [];

  if (failed) {
    return args.concat(prefixed(additionalFlags(...rerunFlagTokens("failed", option))));
  }
  if (repeat) {
    return args.concat(prefixed(additionalFlags(...rerunFlagTokens("repeat", option))));
  }
  if (parallel) {
    args.push(prefixed("inParallel=true"));
    const nodes = parallelNodeCount(n);
    if (nodes !== undefined) {
      args.push(prefixed(`nodes=${nodes}`));
    }
  }
  if (tags) {
    args.push(prefixed(`tags=${tags}`));
  }
  const envNames = joinedEnvironmentNames(env);
  if (envNames) {
    args.push(prefixed(`env=${envNames}`));
  }

  const flags = Object.entries(rest)
    .flatMap(([key, value]) => flagTokens(key, value));
  flags.push(...additionalArgs(launchArgs));
  if (flags.length > 0) {
    args.push(prefixed(additionalFlags(...flags)));
  }

  const targets = joinedSpecTargets(spec);
  if (targets) {
    args.push(prefixed(`specsDir=${targets}`));
  }
  return args;
}

function buildGradleArgs(spec, option = {}) {
  const additionalFlags = (...tokens) => `additionalFlags=${tokens.join(" ")}`;
  return ["clean", "gauge", ...buildJavaRunArgs(spec, option, "-P", additionalFlags)];
}

function buildMavenArgs(spec, option = {}) {
  const additionalFlags = (...tokens) => `flags=${tokens.join(",")}`;
  return [
    "-q",
    "clean",
    "compile",
    "test-compile",
    "gauge:execute",
    ...buildJavaRunArgs(spec, option, "-D", additionalFlags),
  ];
}

const buildRunArgs = {
  forGauge: buildGaugeArgs,
  forGradle: buildGradleArgs,
  forMaven: buildMavenArgs,
};

module.exports = {
  buildRunArgs,
  extractGaugeExecutionOption,
  extractGaugeRunOption,
};
