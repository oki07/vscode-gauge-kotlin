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

function withoutCommonLaunchAttributes(input) {
  return Object.entries(input)
    .filter(([key]) => !commonLaunchAttributes.has(key))
    .reduce((output, [key, value]) => {
      output[key] = value;
      return output;
    }, {});
}

function extractGaugeRunOption(configs) {
  if (!configs) {
    return {};
  }

  const extracted = configs.find((config) => (
    config.type === "gauge" && config.request === "test"
  )) || {};
  return withoutCommonLaunchAttributes(extracted);
}

function flag(key) {
  return `--${key}`;
}

function flagTokens(key, value) {
  if (typeof value === "boolean") {
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

function buildGaugeArgs(spec, option = {}) {
  const args = ["run"];

  if (option.failed) {
    return args.concat(flag("failed"));
  }
  if (option.repeat) {
    return args.concat(flag("repeat"));
  }

  const merged = {
    "hide-suggestion": true,
    "simple-console": !option.parallel,
    ...option,
  };

  for (const [key, value] of Object.entries(merged)) {
    args.push(...flagTokens(key, value));
  }

  if (spec) {
    args.push(spec);
  }

  return args;
}

function buildJavaRunArgs(spec, option = {}, prefix, additionalFlags) {
  const {
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
    return args.concat(prefixed(additionalFlags(flag("failed"))));
  }
  if (repeat) {
    return args.concat(prefixed(additionalFlags(flag("repeat"))));
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
  if (env) {
    args.push(prefixed(`env=${env.join(",")}`));
  }

  const flags = Object.entries(rest)
    .flatMap(([key, value]) => flagTokens(key, value));
  if (flags.length > 0) {
    args.push(prefixed(additionalFlags(...flags)));
  }

  if (spec) {
    args.push(prefixed(`specsDir=${spec}`));
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
  extractGaugeRunOption,
};
