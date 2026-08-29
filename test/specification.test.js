const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

test("buildSpecificationDocument matches the Gauge help template", () => {
  const { buildSpecificationDocument } = require("../src/specification");

  const document = buildSpecificationDocument({
    date: "2026-06-26",
    eol: "\n",
    user: "Ada",
    withHelp: true,
  });

  assert.equal(
    document.text,
    [
      "# SPECIFICATION HEADING",
      "",
      "This is an executable specification file. This file follows markdown syntax.",
      "Every heading in this file denotes a scenario. Every bulleted point denotes a step.",
      "",
      "> To turn off these comments, set the configuration`gauge.create.specification.withHelp` to false.",
      "",
      "## SCENARIO HEADING",
      "",
      "* step",
      "",
    ].join("\n"),
  );
  assert.deepEqual(document.selection, {
    start: { line: 9, character: 2 },
    end: { line: 9, character: 6 },
  });
});

test("buildSpecificationDocument can omit help comments", () => {
  const { buildSpecificationDocument } = require("../src/specification");

  const document = buildSpecificationDocument({
    date: "2026-06-26",
    eol: "\n",
    user: "Ada",
    withHelp: false,
  });

  assert.equal(
    document.text,
    [
      "# SPECIFICATION HEADING",
      "",
      "## SCENARIO HEADING",
      "",
      "* step",
      "",
    ].join("\n"),
  );
  assert.deepEqual(document.selection, {
    start: { line: 4, character: 2 },
    end: { line: 4, character: 6 },
  });
});

test("buildConceptDocument matches the Gauge concept file template", () => {
  const { buildConceptDocument } = require("../src/specification");

  const document = buildConceptDocument({
    date: "2026-06-26",
    eol: "\n",
    user: "Ada",
  });

  assert.equal(
    document.text,
    [
      "Created by Ada on 2026-06-26",
      "",
      "This is a concept file with following syntax for each concept.",
      "# Concept Heading",
      "* step1",
      "* step2",
    ].join("\n"),
  );
  assert.deepEqual(document.selection, {
    start: { line: 3, character: 2 },
    end: { line: 3, character: 17 },
  });
});

test("createSpecification writes a spec file under the workspace specs directory", async () => {
  const { createSpecification } = require("../src/specification");
  const writes = new Map();
  const madeDirectories = [];
  let openedDocument;
  let shownDocument;

  const fileSystem = {
    existsSync() {
      return false;
    },
    promises: {
      async mkdir(directory, options) {
        madeDirectories.push({ directory, options });
      },
      async writeFile(filename, content, encoding) {
        writes.set(filename, { content, encoding });
      },
    },
  };

  class Position {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  }

  class Range {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  }

  const vscode = {
    Position,
    Range,
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/project" } }],
      getConfiguration(section) {
        assert.equal(section, "gauge");
        return {
          get(key) {
            assert.equal(key, "create.specification.withHelp");
            return false;
          },
        };
      },
      async openTextDocument(filename) {
        openedDocument = { filename };
        return openedDocument;
      },
    },
    window: {
      async showInputBox(options) {
        assert.equal(options.placeHolder, "Enter the file name");
        return "Login";
      },
      async showTextDocument(document, options) {
        shownDocument = { document, options };
      },
      async showErrorMessage(message) {
        throw new Error(message);
      },
    },
  };

  await createSpecification({
    vscode,
    fileSystem,
    pathModule: path.posix,
    eol: "\n",
    date: "2026-06-26",
    user: "Ada",
  });

  assert.deepEqual(madeDirectories, [
    { directory: "/project/specs", options: { recursive: true } },
  ]);
  assert.deepEqual(writes.get("/project/specs/Login.spec"), {
    content: [
      "# SPECIFICATION HEADING",
      "",
      "## SCENARIO HEADING",
      "",
      "* step",
      "",
    ].join("\n"),
    encoding: "utf8",
  });
  assert.deepEqual(shownDocument, {
    document: openedDocument,
    options: {
      selection: new Range(new Position(4, 2), new Position(4, 6)),
    },
  });
});

// With no language client running there is no gauge/specDirs answer, and the
// fallback hard coded "specs". A project that moved its specifications with
// gauge_specs_dir (references/gauge/util/util.go GetSpecDirs) then had new
// specifications written into a directory Gauge does not read. The rule already
// lives in src/gaugeSpecScope.js configuredSpecDirs.
test("createSpecification honours gauge_specs_dir without a language client", async () => {
  const { createSpecification } = require("../src/specification");
  const writes = new Map();
  const madeDirectories = [];

  const fileSystem = {
    existsSync() {
      return false;
    },
    readFileSync(filename) {
      if (filename === "/project/env/default/default.properties") {
        return "gauge_specs_dir = features\n";
      }
      throw new Error(`Missing ${filename}`);
    },
    promises: {
      async mkdir(directory, options) {
        madeDirectories.push({ directory, options });
      },
      async writeFile(filename, content, encoding) {
        writes.set(filename, { content, encoding });
      },
    },
  };

  const vscode = {
    Position: class Position {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
    },
    Range: class Range {
      constructor(start, end) {
        this.start = start;
        this.end = end;
      }
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/project" } }],
      getConfiguration: () => ({ get: () => false }),
      async openTextDocument(filename) {
        return { filename };
      },
    },
    window: {
      async showInputBox() {
        return "Login";
      },
      async showTextDocument() {},
      async showErrorMessage(message) {
        throw new Error(message);
      },
    },
  };

  await createSpecification({
    vscode,
    fileSystem,
    pathModule: path.posix,
    eol: "\n",
    date: "2026-06-26",
    user: "Ada",
  });

  assert.deepEqual(madeDirectories, [
    { directory: "/project/features", options: { recursive: true } },
  ]);
  assert.equal(writes.has("/project/features/Login.spec"), true);
});

// With a folder chosen from the Explorer the target is already decided:
// selectSpecDirectory returns options.specDir verbatim and the project root is
// never used. Asking "Choose a project" was therefore a question with no effect,
// and pressing Escape on it aborted the command with the wrong message.
test("createSpecification does not ask for a project when a folder was chosen", async () => {
  const { createSpecification } = require("../src/specification");
  const writes = new Map();
  const quickPicks = [];

  const vscode = {
    Position: class Position {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
    },
    Range: class Range {
      constructor(start, end) {
        this.start = start;
        this.end = end;
      }
    },
    workspace: {
      workspaceFolders: [
        { uri: { fsPath: "/workspace/shop" } },
        { uri: { fsPath: "/workspace/admin" } },
      ],
      getConfiguration: () => ({ get: () => false }),
      openTextDocument: async (filename) => ({ filename }),
    },
    window: {
      showQuickPick(items, options) {
        quickPicks.push({ items, options });
        return Promise.resolve(undefined);
      },
      showInputBox: async () => "Checkout",
      showTextDocument: async () => {},
      showErrorMessage(message) {
        throw new Error(message);
      },
    },
  };

  await createSpecification({
    vscode,
    fileSystem: {
      existsSync: () => false,
      promises: {
        async mkdir() {},
        async writeFile(filename, content) {
          writes.set(filename, content);
        },
      },
    },
    pathModule: path.posix,
    eol: "\n",
    date: "2026-06-26",
    user: "Ada",
    specDir: "/workspace/admin/specs/checkout",
  });

  assert.deepEqual(quickPicks, []);
  assert.equal(writes.has("/workspace/admin/specs/checkout/Checkout.spec"), true);
});

// The Explorer "New Gauge Specification" menu passes the folder the user right
// clicked on straight through as specDir, with none of the gauge_specs_dir
// checking the quick-pick path applies. Gauge only reads specifications from the
// directories named by gauge_specs_dir (references/gauge/util/util.go
// GetSpecDirs), so a specification created in src/ or docs/ is invisible to
// every Gauge command and the user is given no hint why.
test("createSpecification refuses a folder outside the project spec dirs", async () => {
  const { createSpecification } = require("../src/specification");
  const writes = new Map();
  const errors = [];
  const vscode = {
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/workspace/shop" } }],
      getConfiguration: () => ({ get: () => false }),
      openTextDocument: async (filename) => ({ filename }),
    },
    window: {
      showQuickPick: async () => undefined,
      showInputBox: async () => "Checkout",
      showTextDocument: async () => {},
      showErrorMessage(message) {
        errors.push(message);
      },
    },
  };

  await createSpecification({
    vscode,
    fileSystem: {
      existsSync: () => false,
      promises: {
        async mkdir() {},
        async writeFile(filename, content) {
          writes.set(filename, content);
        },
      },
    },
    pathModule: path.posix,
    eol: "\n",
    date: "2026-06-26",
    user: "Ada",
    projects: ["/workspace/shop"],
    specDir: "/workspace/shop/src/main/kotlin",
  });

  assert.deepEqual([...writes.keys()], []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Gauge does not read specifications from \/workspace\/shop\/src\/main\/kotlin\./);
});

// gauge_concepts_dir is unset in almost every project, and Gauge then reads
// concept files from the whole project root
// (references/gauge/util/fileUtils.go GetConceptFiles falls back to
// findConceptFiles([absProjRoot]) when GetConceptsPaths is empty), so every
// folder is a legitimate concept location. configuredConceptDirs answers
// undefined for that case, which the spec-dir scope check must read as "the
// whole project", not crash on.
test("createConcept accepts any folder when gauge_concepts_dir is unset", async () => {
  const { createConcept } = require("../src/specification");
  const writes = new Map();
  const errors = [];
  const vscode = {
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/workspace/shop" } }],
      getConfiguration: () => ({ get: () => false }),
      openTextDocument: async (filename) => ({ filename }),
    },
    window: {
      showQuickPick: async () => undefined,
      showInputBox: async () => "Shared checkout",
      showTextDocument: async () => {},
      showErrorMessage(message) {
        errors.push(message);
      },
    },
  };

  await createConcept({
    vscode,
    fileSystem: {
      existsSync: () => false,
      promises: {
        async mkdir() {},
        async writeFile(filename, content) {
          writes.set(filename, content);
        },
      },
    },
    pathModule: path.posix,
    eol: "\n",
    date: "2026-06-26",
    user: "Ada",
    projects: ["/workspace/shop"],
    specDir: "/workspace/shop/concepts",
  });

  assert.deepEqual(errors, []);
  assert.deepEqual([...writes.keys()], ["/workspace/shop/concepts/Shared checkout.cpt"]);
});

// The Explorer folder resolves to "the root that contains it", picked from the
// known projects or, when the language server has not started, from the
// workspace FOLDERS. For a Gauge project nested at /workspace/e2e inside folder
// /workspace, gauge_specs_dir was then resolved relative to /workspace, so the
// project's own specs/ directory was rejected. Only a real manifest owner can be
// judged against.
test("createSpecification writes into a nested project's own spec directory", async () => {
  const { createSpecification } = require("../src/specification");
  const writes = new Map();
  const errors = [];
  const vscode = {
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
      getConfiguration: () => ({ get: () => false }),
      openTextDocument: async (filename) => ({ filename }),
    },
    window: {
      showQuickPick: async () => undefined,
      showInputBox: async () => "Checkout",
      showTextDocument: async () => {},
      showErrorMessage(message) {
        errors.push(message);
      },
    },
  };

  await createSpecification({
    vscode,
    fileSystem: {
      existsSync: (file) => file === "/workspace/e2e/manifest.json",
      promises: {
        async mkdir() {},
        async writeFile(filename, content) {
          writes.set(filename, content);
        },
      },
    },
    pathModule: path.posix,
    eol: "\n",
    date: "2026-06-26",
    user: "Ada",
    specDir: "/workspace/e2e/specs",
  });

  assert.deepEqual(errors, []);
  assert.deepEqual([...writes.keys()], ["/workspace/e2e/specs/Checkout.spec"]);
});

test("createSpecification asks for project and spec directory when multiple choices exist", async () => {
  const { createSpecification } = require("../src/specification");
  const writes = new Map();
  const madeDirectories = [];
  const quickPicks = [];
  const specDirRequests = [];
  let shownDocument;

  const fileSystem = {
    existsSync() {
      return false;
    },
    promises: {
      async mkdir(directory, options) {
        madeDirectories.push({ directory, options });
      },
      async writeFile(filename, content, encoding) {
        writes.set(filename, { content, encoding });
      },
    },
  };

  class Position {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  }

  class Range {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  }

  const vscode = {
    Position,
    Range,
    workspace: {
      workspaceFolders: [
        { uri: { fsPath: "/workspace/shop" } },
        { uri: { fsPath: "/workspace/admin" } },
      ],
      getConfiguration() {
        return {
          get() {
            return false;
          },
        };
      },
      async openTextDocument(filename) {
        return { filename };
      },
    },
    window: {
      async showQuickPick(items, options) {
        quickPicks.push({ items, options });
        if (quickPicks.length === 1) {
          return items[1];
        }
        return "features/specs";
      },
      async showInputBox() {
        return "Checkout";
      },
      async showTextDocument(document, options) {
        shownDocument = { document, options };
      },
      async showErrorMessage(message) {
        throw new Error(message);
      },
    },
  };

  await createSpecification({
    vscode,
    fileSystem,
    pathModule: path.posix,
    eol: "\n",
    date: "2026-06-26",
    user: "Ada",
    async specDirsProvider(projectRoot) {
      specDirRequests.push(projectRoot);
      return ["specs", "features/specs"];
    },
  });

  assert.deepEqual(specDirRequests, ["/workspace/admin"]);
  assert.deepEqual(quickPicks, [
    {
      items: [
        { label: "shop", description: "/workspace/shop" },
        { label: "admin", description: "/workspace/admin" },
      ],
      options: { canPickMany: false, placeHolder: "Choose a project" },
    },
    {
      items: ["specs", "features/specs"],
      options: {
        canPickMany: false,
        placeHolder: "Choose the folder in which the specification should be created",
      },
    },
  ]);
  assert.deepEqual(madeDirectories, [
    { directory: "/workspace/admin/features/specs", options: { recursive: true } },
  ]);
  assert.deepEqual(writes.get("/workspace/admin/features/specs/Checkout.spec"), {
    content: [
      "# SPECIFICATION HEADING",
      "",
      "## SCENARIO HEADING",
      "",
      "* step",
      "",
    ].join("\n"),
    encoding: "utf8",
  });
  assert.deepEqual(shownDocument, {
    document: { filename: "/workspace/admin/features/specs/Checkout.spec" },
    options: {
      selection: new Range(new Position(4, 2), new Position(4, 6)),
    },
  });
});

test("createSpecification reports spec directory provider failures", async () => {
  const { createSpecification } = require("../src/specification");
  const errors = [];
  const failure = new Error("LSP unavailable");
  const vscode = {
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/project" } }],
    },
    window: {
      async showErrorMessage(message) {
        errors.push(message);
      },
    },
  };

  await assert.doesNotReject(() => createSpecification({
    fileSystem: {},
    pathModule: path.posix,
    specDirsProvider() {
      throw failure;
    },
    vscode,
  }));

  assert.deepEqual(errors, [
    "Unable to generate specification. Error: LSP unavailable",
  ]);
});

test("createSpecification reports existing file errors without overwriting", async () => {
  const { createSpecification } = require("../src/specification");
  const errors = [];
  const existsChecks = [];
  const fileSystem = {
    existsSync(filename) {
      existsChecks.push(filename);
      return filename === "/project/specs/Login.spec";
    },
    promises: {
      async mkdir() {
        throw new Error("mkdir should not run");
      },
      async writeFile() {
        throw new Error("writeFile should not run");
      },
    },
  };
  const vscode = {
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/project" } }],
      async openTextDocument() {
        throw new Error("openTextDocument should not run");
      },
    },
    window: {
      async showInputBox(options) {
        assert.equal(options.placeHolder, "Enter the file name");
        return "Login";
      },
      async showErrorMessage(message) {
        errors.push(message);
      },
      async showTextDocument() {
        throw new Error("showTextDocument should not run");
      },
    },
  };

  await createSpecification({
    fileSystem,
    pathModule: path.posix,
    vscode,
  });

  assert.deepEqual(existsChecks, ["/project/specs/Login.spec"]);
  assert.deepEqual(errors, [
    "Unable to generate specification. File/project/specs/Login.spec already exists.",
  ]);
});

test("createConcept writes a concept file under the workspace specs directory", async () => {
  const { createConcept } = require("../src/specification");
  const writes = new Map();
  const madeDirectories = [];
  let openedDocument;
  let shownDocument;

  const fileSystem = {
    existsSync() {
      return false;
    },
    promises: {
      async mkdir(directory, options) {
        madeDirectories.push({ directory, options });
      },
      async writeFile(filename, content, encoding) {
        writes.set(filename, { content, encoding });
      },
    },
  };

  class Position {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  }

  class Range {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  }

  const vscode = {
    Position,
    Range,
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/project" } }],
      async openTextDocument(filename) {
        openedDocument = { filename };
        return openedDocument;
      },
    },
    window: {
      async showInputBox(options) {
        assert.equal(options.placeHolder, "Enter the concept file name");
        return "Authentication";
      },
      async showTextDocument(document, options) {
        shownDocument = { document, options };
      },
      async showErrorMessage(message) {
        throw new Error(message);
      },
    },
  };

  await createConcept({
    date: "2026-06-26",
    eol: "\n",
    fileSystem,
    pathModule: path.posix,
    user: "Ada",
    vscode,
  });

  assert.deepEqual(madeDirectories, [
    { directory: "/project/specs", options: { recursive: true } },
  ]);
  assert.deepEqual(writes.get("/project/specs/Authentication.cpt"), {
    content: [
      "Created by Ada on 2026-06-26",
      "",
      "This is a concept file with following syntax for each concept.",
      "# Concept Heading",
      "* step1",
      "* step2",
    ].join("\n"),
    encoding: "utf8",
  });
  assert.deepEqual(shownDocument, {
    document: openedDocument,
    options: {
      selection: new Range(new Position(3, 2), new Position(3, 17)),
    },
  });
});

test("createConcept reports spec directory provider failures", async () => {
  const { createConcept } = require("../src/specification");
  const errors = [];
  const failure = new Error("LSP unavailable");
  const vscode = {
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/project" } }],
    },
    window: {
      async showErrorMessage(message) {
        errors.push(message);
      },
    },
  };

  await assert.doesNotReject(() => createConcept({
    fileSystem: {},
    pathModule: path.posix,
    specDirsProvider() {
      throw failure;
    },
    vscode,
  }));

  assert.deepEqual(errors, [
    "Unable to generate concept. Error: LSP unavailable",
  ]);
});

test("createConcept reports existing file errors without overwriting", async () => {
  const { createConcept } = require("../src/specification");
  const errors = [];
  const existsChecks = [];
  const fileSystem = {
    existsSync(filename) {
      existsChecks.push(filename);
      return filename === "/project/specs/Shared.cpt";
    },
    promises: {
      async mkdir() {
        throw new Error("mkdir should not run");
      },
      async writeFile() {
        throw new Error("writeFile should not run");
      },
    },
  };
  const vscode = {
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/project" } }],
      async openTextDocument() {
        throw new Error("openTextDocument should not run");
      },
    },
    window: {
      async showInputBox(options) {
        assert.equal(options.placeHolder, "Enter the concept file name");
        return "Shared";
      },
      async showErrorMessage(message) {
        errors.push(message);
      },
      async showTextDocument() {
        throw new Error("showTextDocument should not run");
      },
    },
  };

  await createConcept({
    fileSystem,
    pathModule: path.posix,
    vscode,
  });

  assert.deepEqual(existsChecks, ["/project/specs/Shared.cpt"]);
  assert.deepEqual(errors, [
    "Unable to generate concept. File/project/specs/Shared.cpt already exists.",
  ]);
});

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createLifecycleFixture(options = {}) {
  const { SpecificationProvider } = require("../src/specification");
  const calls = {
    errors: [],
    exists: [],
    mkdir: [],
    open: [],
    prompts: [],
    requests: [],
    show: [],
    write: [],
  };
  const handlers = new Map();
  const registrationDisposals = new Map();
  const sources = [];
  let provider;

  class CancellationTokenSource {
    constructor() {
      this.cancelCalls = 0;
      this.disposeCalls = 0;
      this.token = { isCancellationRequested: false };
      sources.push(this);
      if (options.onSourceConstructed) {
        options.onSourceConstructed(() => provider, this);
      }
    }

    cancel() {
      this.cancelCalls += 1;
      this.token.isCancellationRequested = true;
      if (options.cancelSource) {
        options.cancelSource(this);
      }
    }

    dispose() {
      this.disposeCalls += 1;
      if (options.disposeSource) {
        options.disposeSource(this);
      }
    }
  }

  const client = {
    sendRequest(method, token) {
      calls.requests.push({ method, token });
      if (options.sendRequest) {
        return options.sendRequest({ calls, getProvider: () => provider, method, token });
      }
      return Promise.resolve(options.specDirs || ["specs"]);
    },
  };
  const clientsMap = new Map([
    ["/project", { client }],
    ["/other", { client }],
  ]);
  if (options.getClient) {
    clientsMap.get = (projectRoot) => options.getClient({
      client,
      getProvider: () => provider,
      projectRoot,
    });
  }
  const fileSystem = {
    existsSync(filename) {
      calls.exists.push(filename);
      if (options.existsSync) {
        return options.existsSync({ calls, filename, getProvider: () => provider });
      }
      return false;
    },
    promises: {
      mkdir(directory, mkdirOptions) {
        calls.mkdir.push({ directory, options: mkdirOptions });
        if (options.mkdir) {
          return options.mkdir({ calls, directory, getProvider: () => provider });
        }
        return Promise.resolve();
      },
      writeFile(filename, content, encoding) {
        calls.write.push({ content, encoding, filename });
        if (options.writeFile) {
          return options.writeFile({ calls, filename, getProvider: () => provider });
        }
        return Promise.resolve();
      },
    },
  };
  const vscode = {
    CancellationTokenSource,
    commands: {
      registerCommand(command, handler) {
        handlers.set(command, handler);
        registrationDisposals.set(command, 0);
        return {
          dispose() {
            registrationDisposals.set(command, registrationDisposals.get(command) + 1);
          },
        };
      },
    },
    workspace: {
      getConfiguration() {
        return { get() { return false; } };
      },
      openTextDocument(filename) {
        calls.open.push(filename);
        if (options.openTextDocument) {
          return options.openTextDocument({ calls, filename, getProvider: () => provider });
        }
        return Promise.resolve({ filename });
      },
      workspaceFolders: [{ uri: { fsPath: "/project" } }],
    },
    window: {
      showErrorMessage(message) {
        calls.errors.push(message);
        if (options.showErrorMessage) {
          return options.showErrorMessage({ calls, getProvider: () => provider, message });
        }
        return Promise.resolve(undefined);
      },
      showInputBox(inputOptions) {
        calls.prompts.push({ kind: "input", options: inputOptions });
        if (options.showInputBox) {
          return options.showInputBox({ calls, getProvider: () => provider, options: inputOptions });
        }
        return Promise.resolve("Feature");
      },
      showQuickPick(items, pickOptions) {
        calls.prompts.push({ items, kind: "quickPick", options: pickOptions });
        if (options.showQuickPick) {
          return options.showQuickPick({ calls, getProvider: () => provider, items, options: pickOptions });
        }
        return Promise.resolve(items[0]);
      },
      showTextDocument(document, showOptions) {
        calls.show.push({ document, options: showOptions });
        if (options.showTextDocument) {
          return options.showTextDocument({ calls, document, getProvider: () => provider });
        }
        return Promise.resolve(options.shownResult || { shown: document });
      },
    },
  };

  provider = new SpecificationProvider(() => clientsMap, {
    createConcept: options.createConcept,
    createSpecification: options.createSpecification,
    eol: "\n",
    fileSystem,
    getProjects: options.getProjects || (() => options.projects || ["/project"]),
    pathModule: path.posix,
    user: "Ada",
    date: "2026-08-24",
    vscode,
  });

  return {
    calls,
    clientsMap,
    handlers,
    provider,
    registrationDisposals,
    sources,
    vscode,
  };
}

test("SpecificationProvider owns specification and concept commands after disposal", async () => {
  const fixture = createLifecycleFixture();
  const specificationHandler = fixture.handlers.get("gauge.create.specification");
  const conceptHandler = fixture.handlers.get("gauge.create.concept");

  assert.equal(typeof specificationHandler, "function");
  assert.equal(typeof conceptHandler, "function");

  fixture.provider.dispose();
  fixture.provider.dispose();

  const outcomes = await Promise.allSettled([
    specificationHandler(),
    conceptHandler(),
    fixture.provider.createSpecification(),
    fixture.provider.createConcept(),
  ]);

  assert.deepEqual(outcomes, [
    { status: "fulfilled", value: undefined },
    { status: "fulfilled", value: undefined },
    { status: "fulfilled", value: undefined },
    { status: "fulfilled", value: undefined },
  ]);
  assert.equal(fixture.registrationDisposals.get("gauge.create.specification"), 1);
  assert.equal(fixture.registrationDisposals.get("gauge.create.concept"), 1);
  assert.equal(fixture.provider.activeOperations.size, 0);
  assert.deepEqual(fixture.calls.requests, []);
  assert.deepEqual(fixture.calls.prompts, []);
  assert.deepEqual(fixture.calls.mkdir, []);
  assert.deepEqual(fixture.calls.write, []);
  assert.deepEqual(fixture.calls.errors, []);
});

test("SpecificationProvider cancels pending spec-directory requests on disposal", async () => {
  for (const kind of ["specification", "concept"]) {
    for (const settlement of ["resolve", "reject"]) {
      const entered = deferred();
      const request = deferred();
      const fixture = createLifecycleFixture({
        sendRequest() {
          entered.resolve();
          return request.promise;
        },
      });
      const handler = fixture.handlers.get(`gauge.create.${kind}`);
      let outcome = { status: "pending" };
      const invocation = handler().then(
        (value) => { outcome = { status: "fulfilled", value }; },
        (error) => { outcome = { error, status: "rejected" }; },
      );

      await entered.promise;
      fixture.provider.dispose();
      await nextTurn();

      assert.deepEqual(outcome, { status: "fulfilled", value: undefined });
      assert.equal(fixture.provider.activeOperations.size, 0);
      assert.equal(fixture.sources.length, 1);
      assert.equal(fixture.sources[0].cancelCalls, 1);
      assert.equal(fixture.sources[0].disposeCalls, 1);
      assert.equal(fixture.sources[0].token.isCancellationRequested, true);
      assert.equal(fixture.calls.requests[0].method, "gauge/specDirs");
      assert.equal(fixture.calls.requests[0].token, fixture.sources[0].token);

      if (settlement === "resolve") {
        request.resolve(["specs"]);
      } else {
        request.reject(new Error(`late ${kind} directories failed`));
      }
      await invocation;
      await nextTurn();

      assert.deepEqual(fixture.calls.prompts, []);
      assert.deepEqual(fixture.calls.mkdir, []);
      assert.deepEqual(fixture.calls.write, []);
      assert.deepEqual(fixture.calls.open, []);
      assert.deepEqual(fixture.calls.show, []);
      assert.deepEqual(fixture.calls.errors, []);
    }
  }
});

test("SpecificationProvider detaches pending creation stages on disposal", async () => {
  const cases = [
    { expected: [0, 0, 0, 0], kind: "specification", stage: "project" },
    { expected: [0, 0, 0, 0], kind: "concept", stage: "directory" },
    { expected: [0, 0, 0, 0], kind: "specification", stage: "input" },
    { expected: [1, 0, 0, 0], kind: "concept", stage: "mkdir" },
    { expected: [1, 1, 0, 0], kind: "specification", stage: "write" },
    { expected: [1, 1, 1, 0], kind: "concept", stage: "open" },
    { expected: [1, 1, 1, 1], kind: "specification", stage: "show" },
  ];

  for (const [index, entry] of cases.entries()) {
    const entered = deferred();
    const gate = deferred();
    const fixture = createLifecycleFixture({
      getProjects() {
        return entry.stage === "project" ? ["/project", "/other"] : ["/project"];
      },
      specDirs: entry.stage === "directory" ? ["specs", "features"] : ["specs"],
      showQuickPick({ items }) {
        const projectPrompt = typeof items[0] === "object";
        if ((entry.stage === "project" && projectPrompt)
          || (entry.stage === "directory" && !projectPrompt)) {
          entered.resolve();
          return gate.promise;
        }
        return Promise.resolve(items[0]);
      },
      showInputBox() {
        if (entry.stage === "input") {
          entered.resolve();
          return gate.promise;
        }
        return Promise.resolve("Feature");
      },
      mkdir() {
        if (entry.stage === "mkdir") {
          entered.resolve();
          return gate.promise;
        }
        return Promise.resolve();
      },
      writeFile() {
        if (entry.stage === "write") {
          entered.resolve();
          return gate.promise;
        }
        return Promise.resolve();
      },
      openTextDocument({ filename }) {
        if (entry.stage === "open") {
          entered.resolve();
          return gate.promise;
        }
        return Promise.resolve({ filename });
      },
      showTextDocument() {
        if (entry.stage === "show") {
          entered.resolve();
          return gate.promise;
        }
        return Promise.resolve({ shown: true });
      },
    });
    const invocation = fixture.handlers.get(`gauge.create.${entry.kind}`)();
    let outcome = { status: "pending" };
    invocation.then(
      (value) => { outcome = { status: "fulfilled", value }; },
      (error) => { outcome = { error, status: "rejected" }; },
    );

    await entered.promise;
    fixture.provider.dispose();
    await nextTurn();

    assert.deepEqual(outcome, { status: "fulfilled", value: undefined }, entry.stage);
    assert.equal(fixture.provider.activeOperations.size, 0, entry.stage);

    if (index % 2 === 0) {
      gate.resolve(entry.stage === "project"
        ? { description: "/project", label: "project" }
        : entry.stage === "directory"
          ? "specs"
          : entry.stage === "input"
            ? "Feature"
            : entry.stage === "open"
              ? { filename: "/project/specs/Feature.cpt" }
              : { shown: true });
    } else {
      gate.reject(new Error(`late ${entry.stage} failed`));
    }
    await invocation;
    await nextTurn();

    assert.deepEqual([
      fixture.calls.mkdir.length,
      fixture.calls.write.length,
      fixture.calls.open.length,
      fixture.calls.show.length,
    ], entry.expected, entry.stage);
    assert.deepEqual(fixture.calls.errors, [], entry.stage);
  }
});

test("SpecificationProvider preserves live creation outcomes and request cleanup", async () => {
  const shownResult = { id: "shown" };
  let requestCount = 0;
  const fixture = createLifecycleFixture({
    sendRequest() {
      requestCount += 1;
      if (requestCount === 2) {
        return Promise.reject(new Error("live directories failed"));
      }
      return Promise.resolve(["specs"]);
    },
    shownResult,
  });

  const specificationResult = await fixture.handlers.get("gauge.create.specification")();
  const conceptResult = await fixture.handlers.get("gauge.create.concept")();

  assert.equal(specificationResult, shownResult);
  assert.equal(conceptResult, undefined);
  assert.equal(fixture.sources.length, 2);
  for (const source of fixture.sources) {
    assert.equal(source.cancelCalls, 0);
    assert.equal(source.disposeCalls, 1);
  }
  assert.equal(fixture.provider.activeOperations.size, 0);
  assert.deepEqual(fixture.calls.errors, [
    "Unable to generate concept. Error: live directories failed",
  ]);
  fixture.provider.dispose();
});

test("SpecificationProvider handles synchronous disposal and concurrent creation", async () => {
  {
    const fixture = createLifecycleFixture({
      onSourceConstructed(getProvider) {
        getProvider().dispose();
      },
    });
    const result = await fixture.handlers.get("gauge.create.specification")();

    assert.equal(result, undefined);
    assert.equal(fixture.sources.length, 1);
    assert.equal(fixture.sources[0].cancelCalls, 1);
    assert.equal(fixture.sources[0].disposeCalls, 1);
    assert.equal(fixture.sources[0].token.isCancellationRequested, true);
    assert.deepEqual(fixture.calls.requests, []);
    assert.deepEqual(fixture.calls.prompts, []);
    assert.deepEqual(fixture.calls.mkdir, []);
    assert.deepEqual(fixture.calls.write, []);
    assert.deepEqual(fixture.calls.open, []);
    assert.deepEqual(fixture.calls.show, []);
    assert.deepEqual(fixture.calls.errors, []);
    assert.equal(fixture.registrationDisposals.get("gauge.create.specification"), 1);
    assert.equal(fixture.registrationDisposals.get("gauge.create.concept"), 1);
    assert.equal(fixture.provider.activeOperations.size, 0);
  }

  {
    const fixture = createLifecycleFixture({
      getClient({ client, getProvider }) {
        getProvider().dispose();
        return { client };
      },
    });
    const result = await fixture.handlers.get("gauge.create.specification")();

    assert.equal(result, undefined);
    assert.equal(fixture.sources.length, 0);
    assert.deepEqual(fixture.calls.requests, []);
    assert.equal(fixture.provider.activeOperations.size, 0);
  }

  {
    const fixture = createLifecycleFixture({
      sendRequest() {
        fixture.provider.dispose();
        return Promise.reject(new Error("request failed after disposal"));
      },
    });
    const result = await fixture.handlers.get("gauge.create.specification")();

    assert.equal(result, undefined);
    assert.equal(fixture.sources.length, 1);
    assert.equal(fixture.sources[0].cancelCalls, 1);
    assert.equal(fixture.sources[0].disposeCalls, 1);
    assert.equal(fixture.provider.activeOperations.size, 0);
    assert.deepEqual(fixture.calls.prompts, []);
    assert.deepEqual(fixture.calls.errors, []);
  }

  {
    const fixture = createLifecycleFixture({
      existsSync() {
        fixture.provider.dispose();
        return false;
      },
    });
    const result = await fixture.handlers.get("gauge.create.concept")();

    assert.equal(result, undefined);
    assert.equal(fixture.provider.activeOperations.size, 0);
    assert.deepEqual(fixture.calls.mkdir, []);
    assert.deepEqual(fixture.calls.write, []);
    assert.deepEqual(fixture.calls.errors, []);
  }

  {
    const requestEntries = [deferred(), deferred()];
    const requestGates = [deferred(), deferred()];
    let requestIndex = 0;
    const fixture = createLifecycleFixture({
      sendRequest() {
        const index = requestIndex;
        requestIndex += 1;
        requestEntries[index].resolve();
        return requestGates[index].promise;
      },
    });
    const specification = fixture.handlers.get("gauge.create.specification")();
    const concept = fixture.handlers.get("gauge.create.concept")();

    await Promise.all(requestEntries.map((entry) => entry.promise));
    fixture.provider.dispose();
    fixture.provider.dispose();

    assert.equal(fixture.provider.activeOperations.size, 0);
    assert.deepEqual(await Promise.all([specification, concept]), [undefined, undefined]);
    assert.equal(fixture.sources.length, 2);
    for (const source of fixture.sources) {
      assert.equal(source.cancelCalls, 1);
      assert.equal(source.disposeCalls, 1);
    }

    requestGates[0].resolve(["specs"]);
    requestGates[1].reject(new Error("late concept directories failed"));
    await nextTurn();
    assert.deepEqual(fixture.calls.prompts, []);
    assert.deepEqual(fixture.calls.errors, []);
  }
});

test("SpecificationProvider completes terminal cleanup when request cancellation throws", async () => {
  const entered = deferred();
  const request = deferred();
  const cancellationError = new Error("cancellation cleanup failed");
  const fixture = createLifecycleFixture({
    cancelSource() {
      throw cancellationError;
    },
    sendRequest() {
      entered.resolve();
      return request.promise;
    },
  });
  const invocation = fixture.handlers.get("gauge.create.specification")();
  await entered.promise;

  let disposalError;
  try {
    fixture.provider.dispose();
  } catch (error) {
    disposalError = error;
  }
  request.resolve(["specs"]);
  const result = await invocation;

  assert.equal(disposalError, undefined);
  assert.equal(result, undefined);
  assert.equal(fixture.sources.length, 1);
  assert.equal(fixture.sources[0].cancelCalls, 1);
  assert.equal(fixture.sources[0].disposeCalls, 1);
  assert.equal(fixture.registrationDisposals.get("gauge.create.specification"), 1);
  assert.equal(fixture.registrationDisposals.get("gauge.create.concept"), 1);
  assert.equal(fixture.provider.activeOperations.size, 0);
});
