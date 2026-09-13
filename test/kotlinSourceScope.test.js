const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { KotlinSourceScope } = require("../src/kotlinSourceScope");

// Kotlin LSP 0.0.12 exportWorkspace and workspace/symbol agree for conventional
// roots, content-only files, literal excludedPatterns, and model reloads.
function model(source = "/workspace/gauge/src") {
  return { modules: [{ name: "gauge", contentRoots: [{
    path: "/workspace/gauge", excludedPatterns: ["excluded"],
    sourceRoots: [{ path: source, type: "java-test" }, {
      path: "/workspace/gauge/resources", type: "java-resource",
    }],
  }] }] };
}

function fixture() {
  const state = { model: model(), exports: [], fail: false };
  const vscode = {
    extensions: { getExtension: () => ({ isActive: true }) },
    commands: {
      getCommands: async () => ["exportWorkspace"],
      async executeCommand(command, directory) {
        assert.equal(command, "exportWorkspace");
        state.exports.push(directory);
        if (state.fail) throw new Error("Server unavailable");
        await fs.writeFile(path.join(directory, "workspace.json"), JSON.stringify(state.model));
        return null;
      },
    },
  };
  return { state, scope: new KotlinSourceScope({ vscode }) };
}

test("Kotlin source scope uses imported roots and retains the last exported model on failure", async () => {
  const { state, scope } = fixture();
  let changes = 0;
  const subscription = scope.onDidChange(() => { changes += 1; });
  try {
    assert.equal(scope.allows("/workspace/gauge/notes/Notes.kt"), undefined);
    await scope.refresh();
    assert.equal(scope.allows("/workspace/gauge/src/Source.kt"), true);
    assert.equal(scope.allows("/workspace/gauge/src/Source.java"), true);
    assert.equal(scope.allows("/workspace/gauge/notes/Notes.kt"), false);
    assert.equal(scope.allows("/workspace/gauge/src/excluded/No.kt"), false);
    assert.equal(scope.allows("/workspace/gauge/src/excludedSibling/Yes.kt"), true);
    // IDEA 2020.1 annotation search includes Kotlin resource sources, but not Java.
    assert.equal(scope.allows("/workspace/gauge/resources/Resource.kt"), true);
    assert.equal(scope.allows("/workspace/gauge/resources/Resource.java"), false);
    assert.equal(scope.allows("/workspace/other/Source.kt"), undefined);
    assert.equal(changes, 1);
    await scope.refresh();
    assert.equal(changes, 1);
    state.fail = true;
    await scope.refresh();
    assert.equal(scope.allows("/workspace/gauge/notes/Notes.kt"), false);
    assert.equal(changes, 1);
    state.fail = false;
    state.model = model("/workspace/gauge/notes");
    await scope.refresh();
    assert.equal(scope.allows("/workspace/gauge/notes/Notes.kt"), true);
    assert.equal(scope.allows("/workspace/gauge/src/Source.kt"), false);
    assert.equal(changes, 2);
    for (const directory of state.exports) await assert.rejects(fs.stat(directory), { code: "ENOENT" });
  } finally {
    subscription.dispose();
    scope.dispose();
  }
});

test("Kotlin source scope does not publish an export after disposal", async () => {
  let release;
  let entered;
  const entering = new Promise((resolve) => { entered = resolve; });
  const ready = new Promise((resolve) => { release = resolve; });
  const { state, scope } = fixture();
  const execute = scope.vscode.commands.executeCommand;
  scope.vscode.commands.executeCommand = async (...args) => { entered(); await ready; return execute(...args); };
  let changes = 0;
  scope.onDidChange(() => { changes += 1; });
  const pending = scope.refresh();
  await entering;
  scope.dispose();
  release();
  await pending;
  assert.equal(changes, 0);
  assert.equal(state.exports.length, 1);
  assert.equal(scope.allows("/workspace/gauge/notes/Notes.kt"), undefined);
  for (const directory of state.exports) await assert.rejects(fs.stat(directory), { code: "ENOENT" });
});

test("Kotlin source scope accepts omitted empty root collections", async () => {
  // Kotlin/kotlin-lsp/workspace-import/src/com/jetbrains/ls/imports/json/model.kt
  // defines empty defaults. Real Kotlin LSP 0.0.12 exportWorkspace omits both
  // collections in this fixture while workspace/symbol still finds SourceStep.
  const exported = require("./fixtures/kotlin-source-empty-roots.json");
  for (const explicit of [false, true]) {
    const { state, scope } = fixture();
    state.model = JSON.parse(JSON.stringify(exported));
    if (explicit) {
      for (const module of state.model.modules) {
        module.contentRoots ||= [];
        for (const content of module.contentRoots) content.sourceRoots ||= [];
      }
    }
    try {
      await scope.refresh();
      assert.equal(scope.allows("/workspace/gauge/src/test/kotlin/SourceStep.kt"), true);
      assert.equal(scope.allows("/workspace/gauge/notes/NotesStep.kt"), false);
      assert.equal(scope.allows("/workspace/gauge/empty-content/NotesStep.kt"), false);
      assert.equal(scope.allows("/workspace/other/SourceStep.kt"), undefined);
      for (const invalid of [null, {}]) {
        state.model = { modules: [{ contentRoots: invalid }] };
        await scope.refresh();
        assert.equal(scope.allows("/workspace/gauge/notes/NotesStep.kt"), false);
        state.model = { modules: [{ contentRoots: [{ path: "/workspace/gauge", sourceRoots: invalid }] }] };
        await scope.refresh();
        assert.equal(scope.allows("/workspace/gauge/notes/NotesStep.kt"), false);
      }
    } finally {
      scope.dispose();
    }
  }
});

test("Kotlin module candidates follow the measured IDEA dependency scope", async () => {
  // IDEA 2020.1 AnnotatedElementsSearch with moduleWithDependenciesAndLibrariesScope
  // includes ordinary/test sources in these nine executed dependency cases.
  const { state, scope } = fixture();
  const cases = [
    ["compile", "compile", false, true, false],
    ["test", "compile", false, true, false],
    ["runtime", "compile", false, false, false],
    ["provided", "compile", false, true, false],
    ["compile", "compile", true, true, true],
    ["compile", "test", true, true, true],
    ["compile", "runtime", true, true, false],
    ["compile", "provided", true, true, true],
    [undefined, "provided", true, false, false],
  ];
  try {
    for (const [direct, transitive, isExported, includeDirect, includeTransitive] of cases) {
      state.model = { modules: ["root", "direct", "transitive", "sibling"].map((name, index) => ({
        name,
        contentRoots: [{ path: `/modules/${name}`, sourceRoots: [
          { path: `/modules/${name}/main`, type: "java-source" },
          { path: `/modules/${name}/test`, type: "java-test" },
        ] }],
        dependencies: index === 0 && direct ? [{ type: "module", name: "direct", scope: direct }]
          : index === 1 ? [{ type: "module", name: "transitive", scope: transitive, isExported }] : [],
      })) };
      await scope.refresh();
      for (const [name, included] of [["direct", includeDirect], ["transitive", includeTransitive], ["sibling", false]]) {
        for (const source of ["main", "test", "notes"]) {
          for (const language of ["kt", "java"]) {
            assert.equal(scope.allows(`/modules/${name}/${source}/Steps.${language}`, "/modules/root"), included && source !== "notes", `${direct}/${transitive}/${isExported}: ${name}/${source}/${language}`);
          }
        }
      }
    }
  } finally { scope.dispose(); }
});

test("Kotlin library paths match supplied classpaths without guessing macro bases", async () => {
  const { state, scope } = fixture();
  const root = "/workspace/gauge";
  state.model.modules[0].dependencies = [{ type: "library", name: "steps", scope: "compile" }];
  state.model.libraries = [{ name: "steps", type: null, roots: [{ path: "<MAVEN_REPO>/group/steps/1/steps-1.jar" }] }];
  try {
    await scope.refresh();
    const archive = "/custom/repository/group/steps/1/steps-1.jar";
    assert.deepEqual(scope.libraryClasspath(root, [archive, "/other.jar", null, 1]), [archive]);
    assert.deepEqual(scope.libraryClasspath(root, []), []);
    state.model.libraries[0].roots[0].path = "<HOME>/libs/steps.jar";
    await scope.refresh();
    assert.deepEqual(scope.libraryClasspath(root, ["/server-home/libs/steps.jar", archive]), ["/server-home/libs/steps.jar"]);
    state.model.libraries[0].roots[0].path = "<UNKNOWN>/steps.jar";
    await scope.refresh();
    assert.deepEqual(scope.libraryClasspath(root, [archive]), [archive]);
    assert.equal(scope.libraryClassFilter(root, archive)("Steps.class"), true);
    // Real IDEA 2020.1 archive-directory annotation search contributes only
    // archives inside its configured discovery directory.
    state.model.libraries[0].roots[0].path = "/archives";
    state.model.libraries[0].roots[0].inclusionOptions = "archives_under_root";
    await scope.refresh();
    assert.deepEqual(scope.libraryClasspath(root, [archive]), []);
    assert.equal(scope.libraryClassFilter(root, archive)("Steps.class"), false);
    state.model.libraries[0].roots[0].path = null;
    await scope.refresh();
    assert.deepEqual(scope.libraryClasspath(root, [archive]), []);
    assert.equal(scope.libraryClassFilter(root, archive)("Steps.class"), false);
    assert.deepEqual(scope.libraryClasspath("/unimported", [archive]), [archive]);
  } finally { scope.dispose(); }
});

test("library exclusions resolve supported macros and retain valid snapshots", async () => {
  const { state, scope } = fixture();
  const root = "/workspace/gauge";
  state.model.modules[0].dependencies = [{ type: "library", name: "steps", scope: "compile" }];
  const library = { name: "steps", roots: [{ path: "<MAVEN_REPO>/group/steps.jar" }], excludedRoots: ["<MAVEN_REPO>/group/steps.jar!/hidden"] };
  state.model.libraries = [library];
  try {
    const archive = "/custom/repository/group/steps.jar";
    await scope.refresh();
    assert.equal(scope.libraryClassFilter(root, archive)("hidden/Step.class"), false);
    assert.equal(scope.libraryClassFilter(root, archive)("hiddenExtra/Step.class"), true);
    library.excludedRoots = [null];
    await scope.refresh();
    assert.equal(scope.libraryClassFilter(root, archive)("hidden/Step.class"), false);
    library.roots[0].path = "<WORKSPACE>/Steps.jar";
    library.excludedRoots = ["<WORKSPACE>/Steps.jar!"];
    await scope.refresh();
    const workspaceArchive = path.join(state.exports.at(-1), "Steps.jar");
    assert.equal(scope.libraryClassFilter(root, workspaceArchive)("Step.class"), false);
    library.excludedRoots = [];
    await scope.refresh();
    assert.equal(scope.libraryClassFilter(root, path.join(state.exports.at(-1), "Steps.jar"))("Step.class"), true);
  } finally { scope.dispose(); }
});

test("archive-entry exclusions use the physical JAR behind a path alias", async () => {
  const { state, scope } = fixture();
  const directory = await fs.mkdtemp(path.join(require("node:os").tmpdir(), "gauge-library-alias-"));
  try {
    const archive = path.join(directory, "steps.jar");
    const alias = path.join(directory, "alias.jar");
    await fs.writeFile(archive, "");
    await fs.symlink(archive, alias);
    state.model.modules[0].dependencies = [{ type: "library", name: "steps", scope: "compile" }];
    state.model.libraries = [{ name: "steps", roots: [{ path: archive }], excludedRoots: [alias + "!/hidden"] }];
    await scope.refresh();
    assert.equal(scope.libraryClassFilter("/workspace/gauge", archive)("hidden/Step.class"), false);
    assert.equal(scope.libraryClassFilter("/workspace/gauge", alias)("kept/Step.class"), true);
  } finally { scope.dispose(); await fs.rm(directory, { recursive: true, force: true }); }
});

test("archive discovery macros use supplied archive parents and preserve depth", async () => {
  const { state, scope } = fixture();
  const root = "/workspace/gauge";
  const top = "/server-home/archives/top.zip";
  const nested = "/server-home/archives/sub/nested.jar";
  state.model.modules[0].dependencies = [{ type: "library", name: "steps", scope: "compile" }];
  const entry = { path: "<HOME>/archives", inclusionOptions: "archives_under_root" };
  state.model.libraries = [{ name: "steps", roots: [entry] }];
  try {
    await scope.refresh();
    assert.deepEqual(scope.archiveDirectoryRoots(root, []), []);
    assert.deepEqual(scope.archiveDirectoryRoots(root, [top, nested]), [{ path: "/server-home/archives", recursive: false }]);
    assert.deepEqual(scope.libraryClasspath(root, [top, nested, "/outside.jar"]), [top]);
    assert.equal(scope.libraryClassFilter(root, nested)("Steps.class"), false);
    entry.inclusionOptions = "archives_under_root_recursively";
    await scope.refresh();
    assert.deepEqual(scope.archiveDirectoryRoots(root, [top, nested]), [{ path: "/server-home/archives", recursive: true }]);
    assert.deepEqual(scope.libraryClasspath(root, [top, nested, "/outside.jar"]), [top, nested]);
    assert.equal(scope.libraryClassFilter(root, nested)("Steps.class"), true);
    entry.path = "<UNKNOWN>/archives";
    await scope.refresh();
    assert.deepEqual(scope.archiveDirectoryRoots(root, [top, nested]), []);
  } finally { scope.dispose(); }
});

function snapshotFixture() {
  const state = {
    calls: [], version: "snapshot-server", error: undefined,
    response: {
      pathMacros: { WORKSPACE: "/server-home/project", HOME: "/server-home", MAVEN_REPO: "/custom-repository" },
      workspace: {
        modules: [{ name: "project", contentRoots: [{ path: "<HOME>/project",
          sourceRoots: [{ path: "<WORKSPACE>/src", type: "java-test" }],
          excludedUrls: ["<HOME>/project/src/generated"],
        }], dependencies: [{ type: "module", name: "dependency", scope: "compile" },
          { type: "library", name: "steps", scope: "compile" }] },
        { name: "dependency", contentRoots: [{ path: "<HOME>/dependency",
          sourceRoots: [{ path: "<HOME>/dependency/src", type: "java-source" }],
        }] }],
        libraries: [{ name: "steps", roots: [{ path: "<MAVEN_REPO>/group/steps.jar" },
          { path: "<HOME>/archives", inclusionOptions: "archives_under_root_recursively" }],
        excludedRoots: ["<MAVEN_REPO>/group/steps.jar!/hidden", "<HOME>/archives/skip.jar!"] }],
      },
    },
  };
  const scope = new KotlinSourceScope({ vscode: {
    extensions: { getExtension: () => ({ isActive: true, packageJSON: { version: state.version } }) },
    commands: {
      getCommands: async () => ["exportWorkspace"],
      async executeCommand(command, directory, options) {
        assert.equal(command, "exportWorkspace");
        state.calls.push({ directory, options });
        if (state.error) throw state.error;
        return state.response;
      },
    },
  } });
  return { state, scope };
}

test("Kotlin snapshot path context resolves source, dependency, library and exclusion roots", async () => {
  // JetBrains/kotlin-lsp workspace-import/src/com/jetbrains/ls/imports/json/conversion.kt
  // uses cached bases for exported paths. Snapshot context supplies those same bases.
  const { state, scope } = snapshotFixture();
  try {
    await scope.refresh();
    assert.deepEqual(state.calls[0].options, { format: "snapshot" });
    assert.deepEqual(scope.moduleRoots(), ["/server-home/project", "/server-home/dependency"]);
    assert.equal(scope.allows("/server-home/project/src/Steps.kt", "/server-home/project"), true);
    assert.equal(scope.allows("/server-home/project/src/generated/Steps.kt", "/server-home/project"), false);
    assert.equal(scope.allows("/server-home/project/notes/Steps.kt", "/server-home/project"), false);
    assert.equal(scope.allows("/server-home/dependency/src/Steps.kt", "/server-home/project"), true);
    assert.deepEqual(scope.libraryClasspath("/server-home/project", []), ["/custom-repository/group/steps.jar"]);
    assert.deepEqual(scope.archiveDirectoryRoots("/server-home/project", []), [{ path: "/server-home/archives", recursive: true }]);
    assert.equal(scope.libraryClassFilter("/server-home/project", "/custom-repository/group/steps.jar")("hidden/Steps.class"), false);
    assert.equal(scope.libraryClassFilter("/server-home/project", "/custom-repository/group/steps.jar")("kept/Steps.class"), true);
    assert.equal(scope.libraryClassFilter("/server-home/project", "/server-home/archives/skip.jar")("Steps.class"), false);
    for (const call of state.calls) await assert.rejects(fs.stat(call.directory), { code: "ENOENT" });
  } finally { scope.dispose(); }
});

test("Kotlin snapshot negotiation falls back for unsupported arguments and retries after extension changes", async () => {
  const { state, scope } = snapshotFixture();
  const snapshot = scope.vscode.commands.executeCommand;
  scope.vscode.commands.executeCommand = async (command, directory, options) => {
    if (state.version === "legacy-server") {
      state.calls.push({ directory, options });
      if (options) throw Object.assign(new Error("Expected 1 argument, got: 2"), { code: -32602 });
      await fs.writeFile(path.join(directory, "workspace.json"), JSON.stringify(model()));
      return null;
    }
    return snapshot(command, directory, options);
  };
  try {
    state.version = "legacy-server";
    await scope.refresh();
    assert.equal(scope.allows("/workspace/gauge/src/Steps.kt"), true);
    await scope.refresh();
    assert.deepEqual(state.calls.map(call => call.options), [{ format: "snapshot" }, undefined, undefined]);
    state.version = "snapshot-server";
    await scope.refresh();
    assert.equal(scope.allows("/server-home/project/src/Steps.kt"), true);
    assert.deepEqual(state.calls.at(-1).options, { format: "snapshot" });
  } finally { scope.dispose(); }
});

test("Kotlin snapshot context rejects malformed bases and retains the last valid model", async () => {
  const { state, scope } = snapshotFixture();
  const valid = structuredClone(state.response);
  let changes = 0;
  scope.onDidChange(() => { changes += 1; });
  try {
    await scope.refresh();
    assert.equal(changes, 1);
    for (const macros of [null, {}, { ...valid.pathMacros, HOME: "relative" }, { ...valid.pathMacros, MAVEN_REPO: 1 }]) {
      state.response = { workspace: { modules: [] }, pathMacros: macros };
      await scope.refresh();
      assert.equal(changes, 1);
      assert.equal(scope.allows("/server-home/project/src/Steps.kt"), true);
    }
    state.response = valid;
    state.response.pathMacros.HOME = "/different-home";
    state.response.pathMacros.WORKSPACE = "/different-home/project";
    await scope.refresh();
    assert.equal(changes, 2);
    assert.equal(scope.allows("/different-home/project/src/Steps.kt"), true);
    assert.equal(scope.allows("/server-home/project/src/Steps.kt"), undefined);
    assert.ok(state.calls.every(call => call.options?.format === "snapshot"));
  } finally { scope.dispose(); }
});

test("Kotlin snapshot transient failures do not trigger legacy exports", async () => {
  const { state, scope } = snapshotFixture();
  try {
    await scope.refresh();
    state.error = Object.assign(new Error("Import unavailable"), { code: -32000 });
    await scope.refresh();
    assert.equal(scope.allows("/server-home/project/src/Steps.kt"), true);
    state.error = undefined;
    await scope.refresh();
    assert.equal(state.calls.length, 3);
    assert.ok(state.calls.every(call => call.options?.format === "snapshot"));
  } finally { scope.dispose(); }
});

test("Kotlin snapshot disposal prevents a rejected capability probe from exporting again", async () => {
  const { state, scope } = snapshotFixture();
  scope.vscode.commands.executeCommand = async (command, directory, options) => {
    state.calls.push({ directory, options });
    scope.dispose();
    throw Object.assign(new Error("Expected 1 argument"), { code: -32602 });
  };
  await scope.refresh();
  assert.equal(state.calls.length, 1);
  assert.deepEqual(state.calls[0].options, { format: "snapshot" });
  assert.deepEqual(scope.moduleRoots(), []);
  await assert.rejects(fs.stat(state.calls[0].directory), { code: "ENOENT" });
});

test("Kotlin snapshot bases preserve literal replacement characters and macro boundaries", async () => {
  const { state, scope } = snapshotFixture();
  state.response.pathMacros.HOME = "/server-$&-home";
  state.response.pathMacros.WORKSPACE = "/server-$&-home/project";
  try {
    await scope.refresh();
    assert.equal(scope.allows("/server-$&-home/project/src/Steps.kt"), true);
    state.response.workspace.modules[0].contentRoots[0].path = "<HOME_OTHER>/project";
    await scope.refresh();
    assert.equal(scope.allows("/server-$&-home/project/src/Steps.kt"), true);
    assert.equal(scope.allows("/project/src/Steps.kt"), undefined);
  } finally { scope.dispose(); }
});
