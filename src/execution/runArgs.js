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
const SPEC_FILE_DELIMITER = "||";
const RERUN_FLAG_KEYS = [
  "hide-suggestion",
  "machine-readable",
  "verbose",
  "simple-console",
  "dir",
  "log-level",
];
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
    return [flag(key), value.join(",")];
  }
  if (typeof value === "string" || typeof value === "number") {
    return [flag(key), `${value}`];
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

function joinedSpecTargets(spec) {
  return specTargets(spec).join(SPEC_FILE_DELIMITER);
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
    if (n) {
      args.push(prefixed(`nodes=${n}`));
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
