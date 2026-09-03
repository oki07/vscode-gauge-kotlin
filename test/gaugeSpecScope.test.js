const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  createMarkdownSpecScope,
  isMarkdownGaugeSpecFile,
  isMarkdownSpecPath,
} = require("../src/gaugeSpecScope");

function gaugeProjectFactory(root = "/workspace/gauge") {
  return {
    isGaugeProject: () => true,
    getGaugeRootFromFilePath: (file) => (String(file).startsWith(`${root}/`) ? root : undefined),
  };
}

function properties(content) {
  return {
    readFileSync(filename) {
      assert.equal(filename, "/workspace/gauge/env/default/default.properties");
      return content;
    },
  };
}

// Gauge decides which extensions count as specifications from
// gauge_spec_file_extensions (getgauge/gauge/env/env.go GaugeSpecFileExtensions,
// default ".spec, .md"), and util.IsValidSpecExtension compares the lowercased
// extension against that list. A project that narrows the list to ".spec" is
// saying its Markdown is documentation, so no Gauge decoration belongs on it.
// Gauge loads EVERY *.properties file in the environment directory, not just
// default.properties: getgauge/gauge/env/env.go loadEnvDir collects them with
// common.FindFilesInDir(envDirPath, isPropertiesFile) and merges them with
// properties.MustLoadFiles, where a later file wins. The bundled Kotlin template
// itself writes env/default/java.properties beside default.properties.
test("configuredSpecDirs reads every properties file in the environment directory", () => {
  const { configuredSpecDirs } = require("../src/gaugeSpecScope");
  const files = {
    "/workspace/gauge/env/default/default.properties": "gauge_reports_dir = reports\n",
    "/workspace/gauge/env/default/java.properties": "gauge_specs_dir = features\n",
  };

  assert.deepEqual(
    configuredSpecDirs({
      pathModule: path.posix,
      projectRoot: "/workspace/gauge",
      fileSystem: {
        readdirSync: () => ["default.properties", "java.properties", "notes.txt"],
        readFileSync(filename) {
          if (files[filename] === undefined) {
            throw new Error(`Missing ${filename}`);
          }
          return files[filename];
        },
      },
    }),
    [["features"]],
  );
});

// `gauge validate` reads env/default/nested/custom.properties and validates
// interpolated/interpolation.spec. Gauge recursively collects properties files
// from the selected environment directory.
test("configuredSpecDirs reads nested environment properties files", () => {
  const { configuredSpecDirs } = require("../src/gaugeSpecScope");
  const files = {
    "/workspace/gauge/env/default/default.properties": "gauge_reports_dir = reports\n",
    "/workspace/gauge/env/default/nested/custom.properties": "gauge_specs_dir = interpolated\n",
  };

  assert.deepEqual(
    configuredSpecDirs({
      pathModule: path.posix,
      projectRoot: "/workspace/gauge",
      fileSystem: {
        readdirSync(directory) {
          if (directory === "/workspace/gauge/env/default") {
            return ["default.properties", "nested"];
          }
          if (directory === "/workspace/gauge/env/default/nested") {
            return ["custom.properties"];
          }
          throw new Error(`Missing ${directory}`);
        },
        readFileSync(filename) {
          if (files[filename] === undefined) {
            throw new Error(`Missing ${filename}`);
          }
          return files[filename];
        },
      },
    }),
    [["interpolated"]],
  );
});

// properties.MustLoadFiles merges in order, so the last file to define a key
// wins.
test("configuredSpecDirs lets the last properties file win", () => {
  const { configuredSpecDirs } = require("../src/gaugeSpecScope");
  const files = {
    "/workspace/gauge/env/default/a.properties": "gauge_specs_dir = first\n",
    "/workspace/gauge/env/default/b.properties": "gauge_specs_dir = second\n",
  };

  assert.deepEqual(
    configuredSpecDirs({
      pathModule: path.posix,
      projectRoot: "/workspace/gauge",
      fileSystem: {
        readdirSync: () => ["b.properties", "a.properties"],
        readFileSync: (filename) => {
          if (files[filename] === undefined) {
            throw new Error(`Missing ${filename}`);
          }
          return files[filename];
        },
      },
    }),
    [["second"]],
  );
});

// `gauge validate` resolves `gauge_specs_dir = fea\\` plus `tures` as
// `features` and validates features/continuation.spec. Gauge properties use an
// odd trailing backslash as the physical-line continuation marker.
test("configuredSpecDirs joins continued property values", () => {
  const { configuredSpecDirs } = require("../src/gaugeSpecScope");

  assert.deepEqual(
    configuredSpecDirs({
      pathModule: path.posix,
      projectRoot: "/workspace/gauge",
      fileSystem: {
        readdirSync: () => ["default.properties"],
        readFileSync: () => "gauge_specs_dir = fea\\\n  tures\n",
      },
    }),
    [["features"]],
  );
});

// `gauge validate` resolves feature\\#s to feature#s and validates the
// specification in that directory. A Java-properties backslash escapes a
// marker character inside a value instead of creating a path separator.
test("configuredSpecDirs unescapes property marker characters", () => {
  const { configuredSpecDirs } = require("../src/gaugeSpecScope");

  assert.deepEqual(
    configuredSpecDirs({
      pathModule: path.posix,
      projectRoot: "/workspace/gauge",
      fileSystem: {
        readdirSync: () => ["default.properties"],
        readFileSync: () => "gauge_specs_dir = feature\\#s\n",
      },
    }),
    [["feature#s"]],
  );
});

// `gauge validate` resolves feature\\qs to featureqs and validates the
// specification in that directory. Java properties discard the backslash for
// an otherwise unrecognised escaped character too.
test("configuredSpecDirs unescapes unknown property characters", () => {
  const { configuredSpecDirs } = require("../src/gaugeSpecScope");

  assert.deepEqual(
    configuredSpecDirs({
      pathModule: path.posix,
      projectRoot: "/workspace/gauge",
      fileSystem: {
        readdirSync: () => ["default.properties"],
        readFileSync: () => "gauge_specs_dir = feature\\qs\n",
      },
    }),
    [["featureqs"]],
  );
});

// `gauge validate` resolves gauge_specs_dir = ${spec_root} from the matching
// property and validates interpolated/interpolation.spec. Gauge expands a
// property reference before it selects the specification directories.
test("configuredSpecDirs expands property references", () => {
  const { configuredSpecDirs } = require("../src/gaugeSpecScope");

  assert.deepEqual(
    configuredSpecDirs({
      pathModule: path.posix,
      projectRoot: "/workspace/gauge",
      fileSystem: {
        readdirSync: () => ["default.properties"],
        readFileSync: () => "spec_root = interpolated\ngauge_specs_dir = ${spec_root}\n",
      },
    }),
    [["interpolated"]],
  );
});

// `gauge validate` refuses first=${second} and second=${first} as a circular
// reference. The editor must not treat the unresolved marker as a directory.
test("configuredSpecDirs ignores circular property references", () => {
  const { configuredSpecDirs } = require("../src/gaugeSpecScope");

  assert.deepEqual(
    configuredSpecDirs({
      pathModule: path.posix,
      projectRoot: "/workspace/gauge",
      fileSystem: {
        readdirSync: () => ["default.properties"],
        readFileSync: () => "first = ${second}\nsecond = ${first}\ngauge_specs_dir = ${first}\n",
      },
    }),
    [["specs"]],
  );
});

// `gauge validate` reports "invalid unicode literal" and refuses the
// environment for invalid\\uZZZZ. The editor must not reinterpret that invalid
// value as a different directory name.
test("configuredSpecDirs ignores invalid property Unicode escapes", () => {
  const { configuredSpecDirs } = require("../src/gaugeSpecScope");

  assert.deepEqual(
    configuredSpecDirs({
      pathModule: path.posix,
      projectRoot: "/workspace/gauge",
      fileSystem: {
        readdirSync: () => ["default.properties"],
        readFileSync: () => "gauge_specs_dir = invalid\\uZZZZ\n",
      },
    }),
    [["specs"]],
  );
});

// The environment directory itself is not fixed: getgauge/gauge/env/env.go
// getEnvDir prefers the gauge_env_dir variable and otherwise takes
// EnvironmentDir from the project manifest.
test("configuredSpecDirs honours a manifest EnvironmentDir", () => {
  const { configuredSpecDirs } = require("../src/gaugeSpecScope");
  const files = {
    "/workspace/gauge/manifest.json": JSON.stringify({
      Language: "java",
      EnvironmentDir: "environments",
    }),
    "/workspace/gauge/environments/default/default.properties": "gauge_specs_dir = features\n",
  };

  assert.deepEqual(
    configuredSpecDirs({
      pathModule: path.posix,
      projectRoot: "/workspace/gauge",
      fileSystem: {
        readdirSync: () => ["default.properties"],
        readFileSync: (filename) => {
          if (files[filename] === undefined) {
            throw new Error(`Missing ${filename}`);
          }
          return files[filename];
        },
      },
    }),
    [["features"]],
  );
});

// `env gauge_env_dir=/tmp gauge validate specs` reports that the variable must
// be relative to the project root. An invalid absolute value must not make the
// editor read a project-relative lookalike such as /workspace/gauge/tmp.
test("configuredSpecDirs ignores an absolute gauge_env_dir", () => {
  const { configuredSpecDirs } = require("../src/gaugeSpecScope");
  const previous = process.env.gauge_env_dir;
  const reads = [];
  process.env.gauge_env_dir = "/tmp";
  try {
    assert.deepEqual(
      configuredSpecDirs({
        pathModule: path.posix,
        projectRoot: "/workspace/gauge",
        fileSystem: {
          readdirSync(directory) {
            reads.push(directory);
            return ["default.properties"];
          },
          readFileSync(filename) {
            reads.push(filename);
            return "gauge_specs_dir = wrong-directory\n";
          },
        },
      }),
      [["specs"]],
    );
    assert.deepEqual(reads, []);
  } finally {
    if (previous === undefined) {
      delete process.env.gauge_env_dir;
    } else {
      process.env.gauge_env_dir = previous;
    }
  }
});


test("isMarkdownGaugeSpecFile honours a narrowed gauge_spec_file_extensions", () => {
  const { isMarkdownGaugeSpecFile } = require("../src/gaugeSpecScope");
  const options = {
    pathModule: path.posix,
    projectRoot: "/workspace/gauge",
    fileSystem: {
      readFileSync(filename) {
        if (filename === "/workspace/gauge/env/default/default.properties") {
          return "gauge_spec_file_extensions = .spec\n";
        }
        throw new Error(`Missing ${filename}`);
      },
    },
  };

  assert.equal(isMarkdownGaugeSpecFile("/workspace/gauge/specs/checkout.md", options), false);
});

test("isMarkdownGaugeSpecFile keeps Markdown when the list still names it", () => {
  const { isMarkdownGaugeSpecFile } = require("../src/gaugeSpecScope");
  const options = {
    pathModule: path.posix,
    projectRoot: "/workspace/gauge",
    fileSystem: {
      readFileSync(filename) {
        if (filename === "/workspace/gauge/env/default/default.properties") {
          return "gauge_spec_file_extensions = .spec, .md\n";
        }
        throw new Error(`Missing ${filename}`);
      },
    },
  };

  assert.equal(isMarkdownGaugeSpecFile("/workspace/gauge/specs/checkout.md", options), true);
});


test("markdown spec scope defaults to the specs directory", () => {
  const scope = createMarkdownSpecScope({
    fileSystem: { readFileSync() { throw new Error("absent"); } },
    pathModule: path.posix,
    projectRoot: "/workspace/gauge",
  });

  assert.equal(isMarkdownSpecPath("/workspace/gauge/specs/checkout.md", scope), true);
  assert.equal(isMarkdownSpecPath("/workspace/gauge/README.md", scope), false);
  assert.equal(isMarkdownSpecPath("/workspace/gauge/docs/specs/design.md", scope), false);
});

test("markdown spec scope follows every configured gauge_specs_dir", () => {
  const scope = createMarkdownSpecScope({
    fileSystem: properties("gauge_specs_dir = api-specs, ui/specs\n"),
    pathModule: path.posix,
    projectRoot: "/workspace/gauge",
  });

  assert.equal(isMarkdownSpecPath("/workspace/gauge/api-specs/a.md", scope), true);
  assert.equal(isMarkdownSpecPath("/workspace/gauge/ui/specs/b.md", scope), true);
  assert.equal(isMarkdownSpecPath("/workspace/gauge/specs/c.md", scope), false);
});

// The point is that the scope resolves once and every later file reuses it, not
// the absolute count: resolving now also reads the manifest to find the
// environment directory (getgauge/gauge/env/env.go getEnvDir).
test("markdown spec scope reads the project properties at most once", () => {
  let propertyReads = 0;
  const scope = createMarkdownSpecScope({
    fileSystem: {
      readFileSync(filename) {
        if (String(filename).endsWith(".properties")) {
          propertyReads += 1;
          return "gauge_specs_dir = anotherSpecDir\n";
        }
        throw new Error(`Missing ${filename}`);
      },
    },
    pathModule: path.posix,
    projectRoot: "/workspace/gauge",
  });

  for (const file of ["a.md", "b.md", "c.md"]) {
    isMarkdownSpecPath(`/workspace/gauge/anotherSpecDir/${file}`, scope);
  }

  assert.equal(propertyReads, 1);
});

test("markdown spec scope keeps the default directory name without a project", () => {
  const scope = createMarkdownSpecScope({ pathModule: path.posix });

  assert.equal(isMarkdownSpecPath("/anywhere/specs/checkout.md", scope), true);
  assert.equal(isMarkdownSpecPath("/anywhere/notes.md", scope), false);
});

test("isMarkdownGaugeSpecFile resolves the project itself", () => {
  const options = {
    fileSystem: properties("gauge_specs_dir = anotherSpecDir\n"),
    pathModule: path.posix,
    projectFactory: gaugeProjectFactory(),
  };

  assert.equal(isMarkdownGaugeSpecFile("/workspace/gauge/anotherSpecDir/a.md", options), true);
  assert.equal(isMarkdownGaugeSpecFile("/workspace/gauge/specs/a.md", options), false);
  assert.equal(isMarkdownGaugeSpecFile("/workspace/gauge/README.md", options), false);
});

test("isMarkdownGaugeSpecFile answers false for anything that is not Markdown", () => {
  const options = { pathModule: path.posix, projectFactory: gaugeProjectFactory() };

  assert.equal(isMarkdownGaugeSpecFile("/workspace/gauge/specs/a.spec", options), false);
  assert.equal(isMarkdownGaugeSpecFile("/workspace/gauge/specs/a.cpt", options), false);
  assert.equal(isMarkdownGaugeSpecFile("", options), false);
});

test("isMarkdownGaugeSpecFile falls back to the default directory outside a Gauge project", () => {
  const options = { pathModule: path.posix, projectFactory: gaugeProjectFactory() };

  assert.equal(isMarkdownGaugeSpecFile("/elsewhere/specs/a.md", options), true);
  assert.equal(isMarkdownGaugeSpecFile("/elsewhere/notes.md", options), false);
});
