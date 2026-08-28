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
// gauge_spec_file_extensions (references/gauge/env/env.go GaugeSpecFileExtensions,
// default ".spec, .md"), and util.IsValidSpecExtension compares the lowercased
// extension against that list. A project that narrows the list to ".spec" is
// saying its Markdown is documentation, so no Gauge decoration belongs on it.
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

test("markdown spec scope reads the project properties at most once", () => {
  let reads = 0;
  const scope = createMarkdownSpecScope({
    fileSystem: {
      readFileSync() {
        reads += 1;
        return "gauge_specs_dir = anotherSpecDir\n";
      },
    },
    pathModule: path.posix,
    projectRoot: "/workspace/gauge",
  });

  for (const file of ["a.md", "b.md", "c.md"]) {
    isMarkdownSpecPath(`/workspace/gauge/anotherSpecDir/${file}`, scope);
  }

  assert.equal(reads, 1);
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
