const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

test("GaugeConfig resolves plugin path from GAUGE_HOME", () => {
  const { GaugeConfig } = require("../src/config/gaugeConfig");

  const config = new GaugeConfig("darwin", {
    env: { GAUGE_HOME: "/custom/gauge" },
    pathModule: path.posix,
  });

  assert.equal(config.pluginsPath(), "/custom/gauge/plugins");
});

test("GaugeConfig resolves Windows plugin path from APPDATA", () => {
  const { GaugeConfig } = require("../src/config/gaugeConfig");

  const config = new GaugeConfig("win32", {
    env: { APPDATA: "/Users/userName/AppData/Roaming" },
    pathModule: path.posix,
  });

  assert.equal(config.pluginsPath(), "/Users/userName/AppData/Roaming/Gauge/plugins");
});

test("GaugeConfig resolves Windows plugin path from GAUGE_HOME", () => {
  const { GaugeConfig } = require("../src/config/gaugeConfig");

  const config = new GaugeConfig("win32", {
    env: {
      APPDATA: "/Users/userName/AppData/Roaming",
      GAUGE_HOME: "/custom/gauge",
    },
    pathModule: path.posix,
  });

  assert.equal(config.pluginsPath(), "/custom/gauge/plugins");
});

test("GaugeConfig resolves non-Windows plugin path from the user home", () => {
  const { GaugeConfig } = require("../src/config/gaugeConfig");

  const config = new GaugeConfig("darwin", {
    env: {},
    homeDir() {
      return "/Users/userName";
    },
    pathModule: path.posix,
  });

  assert.equal(config.pluginsPath(), "/Users/userName/.gauge/plugins");
});

test("GaugeJavaProjectConfig writes Eclipse Java project files", () => {
  const { GaugeJavaProjectConfig } = require("../src/config/gaugeProjectConfig");
  const execCalls = [];
  const writes = new Map();
  const fileSystem = {
    existsSync(filename) {
      return writes.has(filename);
    },
    readdirSync(dirname) {
      assert.equal(dirname, "/gauge/plugins/java/1.0.0/libs");
      return ["gauge-java.jar", "assertj-core.jar", "other.jar"];
    },
    writeFileSync(filename, content, encoding) {
      writes.set(filename, { content, encoding });
    },
  };
  const config = new GaugeJavaProjectConfig(
    "/workspace/gauge",
    "1.0.0",
    {
      pluginsPath() {
        return "/gauge/plugins";
      },
    },
    {
      exec(command, callback) {
        execCalls.push(command);
        callback(null, "", "openjdk version \"17.0.9\" 2023-10-17");
      },
      fileSystem,
      pathModule: path.posix,
    },
  );

  config.generate();

  assert.deepEqual(execCalls, ["java -version"]);
  assert.equal(writes.get("/workspace/gauge/.project").encoding, "utf8");
  assert.match(
    writes.get("/workspace/gauge/.project").content,
    /<nature>org\.eclipse\.jdt\.core\.javanature<\/nature>/,
  );
  assert.equal(writes.get("/workspace/gauge/.classpath").encoding, "utf8");
  assert.match(
    writes.get("/workspace/gauge/.classpath").content,
    /JavaSE-17/,
  );
  assert.match(
    writes.get("/workspace/gauge/.classpath").content,
    /gauge-java\.jar/,
  );
  assert.match(
    writes.get("/workspace/gauge/.classpath").content,
    /assertj-core\.jar/,
  );
  assert.doesNotMatch(
    writes.get("/workspace/gauge/.classpath").content,
    /other\.jar/,
  );
});

test("GaugeJavaProjectConfig normalizes early-access Java versions", () => {
  const { GaugeJavaProjectConfig } = require("../src/config/gaugeProjectConfig");
  const writes = new Map();
  const fileSystem = {
    existsSync(filename) {
      return writes.has(filename);
    },
    readdirSync(dirname) {
      assert.equal(dirname, "/gauge/plugins/java/1.0.0/libs");
      return ["gauge-java.jar"];
    },
    writeFileSync(filename, content, encoding) {
      writes.set(filename, { content, encoding });
    },
  };
  const config = new GaugeJavaProjectConfig(
    "/workspace/gauge",
    "1.0.0",
    {
      pluginsPath() {
        return "/gauge/plugins";
      },
    },
    {
      exec(command, callback) {
        assert.equal(command, "java -version");
        callback(null, "", "openjdk version \"21-ea\" 2023-09-19");
      },
      fileSystem,
      pathModule: path.posix,
    },
  );

  config.generate();

  assert.match(
    writes.get("/workspace/gauge/.classpath").content,
    /JavaSE-21/,
  );
  assert.doesNotMatch(
    writes.get("/workspace/gauge/.classpath").content,
    /JavaSE-21-ea/,
  );
});
