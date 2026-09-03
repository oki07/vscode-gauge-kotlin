"use strict";

// The integration tests drive the real Gauge CLI over a real Gradle build, so
// they need a Gauge installation carrying the Java runner plugin. A machine
// that already has one is used as it is; otherwise a pinned Gauge is placed in
// a throwaway directory inside the checkout, with its own GAUGE_HOME so the
// developer's own plugins and configuration are never touched.

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const yauzl = require("yauzl");

const root = path.join(__dirname, "..");

// Pinned so a run is reproducible. Raise them deliberately, and re-run the
// suite against the new pair.
const GAUGE_VERSION = process.env.GAUGE_INTEGRATION_VERSION || "1.6.36";
const JAVA_PLUGIN_VERSION = process.env.GAUGE_INTEGRATION_JAVA_VERSION || "1.0.3";

const RELEASES = "https://github.com/getgauge";

// A downloaded third-party toolchain is not part of the source tree, so it
// lives in the user's cache directory and is shared by every checkout.
function cacheRoot() {
  if (os.platform() === "win32") {
    return process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  }
  return process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
}

const toolchainDir = process.env.GAUGE_TOOLCHAIN_DIR
  || path.join(cacheRoot(), "vscode-gauge-kotlin", "gauge-toolchain");
const downloadDir = path.join(toolchainDir, "downloads");
const binDir = path.join(toolchainDir, "bin");
const gaugeHome = path.join(toolchainDir, "home");

const TEST_FILES = [
  path.join("test", "execution", "selectedScenarioLifecycle.integration.test.js"),
];

// Gauge names its release assets <name>-<version>-<os>.<arch>.zip, and reads
// that name back when installing a plugin from a file
// (references/gauge/build/make.go, references/gauge-java/build/make.go).
function assetPlatform() {
  const platform = { win32: "windows", darwin: "darwin", linux: "linux" }[os.platform()];
  const arch = { x64: "x86_64", arm64: "arm64", ia32: "x86" }[os.arch()];
  if (!platform || !arch) {
    throw new Error(`no Gauge release asset for ${os.platform()} ${os.arch()}`);
  }
  return { platform, arch };
}

function assetName(name, version) {
  const { platform, arch } = assetPlatform();
  return `${name}-${version}-${platform}.${arch}.zip`;
}

function gaugeExecutable() {
  return path.join(binDir, os.platform() === "win32" ? "gauge.exe" : "gauge");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
  return result;
}

function capture(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", ...options });
}

// curl is present on macOS, on Linux and on Windows 10 and later, and it obeys
// the proxy variables a corporate network needs. Node's own client is the
// fallback for a machine without it.
function download(url, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination) && fs.statSync(destination).size > 0) {
    return Promise.resolve(destination);
  }
  const curl = capture("curl", ["--version"]);
  if (!curl.error && curl.status === 0) {
    run("curl", ["-sSL", "--fail", "-o", destination, url]);
    return Promise.resolve(destination);
  }
  return new Promise((resolve, reject) => {
    const request = (target, redirects) => {
      https.get(target, (response) => {
        const location = response.headers.location;
        if (location && response.statusCode >= 300 && response.statusCode < 400) {
          if (redirects === 0) {
            reject(new Error(`too many redirects for ${url}`));
            return;
          }
          response.resume();
          request(new URL(location, target).toString(), redirects - 1);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`GET ${target} returned ${response.statusCode}`));
          return;
        }
        const file = fs.createWriteStream(destination);
        response.pipe(file);
        file.on("finish", () => file.close(() => resolve(destination)));
        file.on("error", reject);
      }).on("error", reject);
    };
    request(url, 5);
  });
}

// An archive entry names its own destination, so a name that climbs out of the
// target directory is refused rather than written.
function destinationFor(directory, entryName) {
  const target = path.resolve(directory, entryName);
  const prefix = path.resolve(directory) + path.sep;
  if (target !== path.resolve(directory) && !target.startsWith(prefix)) {
    throw new Error(`archive entry escapes the target directory: ${entryName}`);
  }
  return target;
}

function extract(archivePath, directory) {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (openError, archive) => {
      if (openError) {
        reject(openError);
        return;
      }
      archive.on("error", reject);
      archive.on("end", resolve);
      archive.on("entry", (entry) => {
        let destination;
        try {
          destination = destinationFor(directory, entry.fileName);
        } catch (error) {
          reject(error);
          return;
        }
        if (entry.fileName.endsWith("/")) {
          fs.mkdirSync(destination, { recursive: true });
          archive.readEntry();
          return;
        }
        archive.openReadStream(entry, (streamError, stream) => {
          if (streamError) {
            reject(streamError);
            return;
          }
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          const file = fs.createWriteStream(destination);
          stream.pipe(file);
          file.on("finish", () => {
            file.close(() => {
              // The zip carries the executable bit in the upper half of the
              // external attributes; without it the extracted CLI cannot run.
              const mode = (entry.externalFileAttributes >>> 16) & 0o777;
              if (mode) {
                fs.chmodSync(destination, mode);
              }
              archive.readEntry();
            });
          });
          file.on("error", reject);
        });
      });
      archive.readEntry();
    });
  });
}

function pluginsOf(gauge, env) {
  const version = capture(gauge, ["version"], { env });
  if (version.error || version.status !== 0) {
    return null;
  }
  return String(version.stdout || "");
}

function usableGauge(gauge, env) {
  const output = pluginsOf(gauge, env);
  return Boolean(output && /^java \(/m.test(output));
}

async function provision() {
  fs.mkdirSync(gaugeHome, { recursive: true });
  const env = { ...process.env, GAUGE_HOME: gaugeHome };
  const gauge = gaugeExecutable();

  if (!fs.existsSync(gauge)) {
    const archive = assetName("gauge", GAUGE_VERSION);
    process.stdout.write(`fetching ${archive}\n`);
    await download(
      `${RELEASES}/gauge/releases/download/v${GAUGE_VERSION}/${archive}`,
      path.join(downloadDir, archive),
    );
    await extract(path.join(downloadDir, archive), binDir);
  }

  if (!usableGauge(gauge, env)) {
    const archive = assetName("gauge-java", JAVA_PLUGIN_VERSION);
    process.stdout.write(`fetching ${archive}\n`);
    // Gauge reads the platform out of the file name it is given, so the asset
    // keeps the name it was published under.
    const archivePath = path.join(downloadDir, archive);
    await download(
      `${RELEASES}/gauge-java/releases/download/v${JAVA_PLUGIN_VERSION}/${archive}`,
      archivePath,
    );
    run(gauge, ["install", "java", "--file", archivePath], { env });
  }

  return { gauge, env };
}

function resolveGradle() {
  if (process.env.GAUGE_LIFECYCLE_GRADLE) {
    return process.env.GAUGE_LIFECYCLE_GRADLE;
  }
  const command = os.platform() === "win32" ? "gradle.bat" : "gradle";
  const probe = capture(command, ["--version"]);
  if (!probe.error && probe.status === 0) {
    return command;
  }
  return null;
}

async function main() {
  const gradle = resolveGradle();
  if (!gradle) {
    throw new Error(
      "no Gradle on PATH. Install Gradle, or point GAUGE_LIFECYCLE_GRADLE at it.",
    );
  }

  // A machine that already runs Gauge with the Java plugin needs nothing
  // downloaded.
  let gauge = process.env.GAUGE_LIFECYCLE_GAUGE;
  let env = { ...process.env };
  if (!gauge && usableGauge("gauge", env)) {
    gauge = "gauge";
  }
  if (!gauge) {
    const provisioned = await provision();
    gauge = provisioned.gauge;
    env = provisioned.env;
  }

  process.stdout.write(`gauge:  ${gauge}\ngradle: ${gradle}\n`);
  run(process.execPath, ["--test", ...TEST_FILES], {
    cwd: root,
    env: { ...env, GAUGE_LIFECYCLE_GAUGE: gauge, GAUGE_LIFECYCLE_GRADLE: gradle },
  });
}

main().catch((error) => {
  process.exitCode = 1;
  process.stderr.write(`${error.stack || error}\n`);
});
