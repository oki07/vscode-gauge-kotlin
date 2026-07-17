"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

function createDocument(text, fsPath, languageId, version = 0) {
  const lines = text.split(/\r?\n/);
  return {
    languageId,
    version,
    uri: {
      fsPath,
      toString() {
        return `file://${fsPath}`;
      },
    },
    getText() {
      return text;
    },
    lineAt(line) {
      return { text: lines[line] || "" };
    },
  };
}

class FakeDocumentStore {
  constructor(documents) {
    this.currentDocuments = documents;
    this.listeners = new Set();
    this.generation = 1;
  }

  async whenReady() {}

  isScanComplete() {
    return true;
  }

  documents() {
    return this.currentDocuments;
  }

  onDidChangeDocuments(listener) {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  replace(document) {
    const file = document.uri.fsPath;
    this.currentDocuments = this.currentDocuments
      .filter((candidate) => candidate.uri.fsPath !== file)
      .concat(document);
    this.generation += 1;
    for (const listener of this.listeners) {
      listener({ file });
    }
  }
}

function createProjectFactory() {
  return {
    getGaugeRootFromFilePath(file) {
      if (!file.startsWith("/workspace/gauge/")) {
        throw new Error("not a Gauge project file");
      }
      return "/workspace/gauge";
    },
    isGaugeProject(root) {
      return root === "/workspace/gauge";
    },
  };
}

test("WorkspaceStepIndex shares completion, definition, and reference analysis", async () => {
  const { WorkspaceStepIndex } = require("../src/workspaceStepIndex");
  const constants = createDocument([
    "package steps",
    "const val STEP_TEXT = \"Before\"",
  ].join("\n"), "/workspace/gauge/src/Constants.kt", "kotlin");
  const implementation = createDocument([
    "package steps",
    "import com.thoughtworks.gauge.Step",
    "@Step(STEP_TEXT)",
    "fun run() {}",
  ].join("\n"), "/workspace/gauge/src/Steps.kt", "kotlin");
  const specification = createDocument([
    "# Example",
    "* Before",
  ].join("\n"), "/workspace/gauge/specs/example.spec", "gauge", 1);
  const store = new FakeDocumentStore([constants, implementation, specification]);
  const index = new WorkspaceStepIndex({
    documentStore: store,
    projectFactory: createProjectFactory(),
    vscode: { workspace: { textDocuments: [specification] } },
  });

  const completion = await index.completionEntries(specification);
  const definitions = await index.definitionEntries(specification, ["Before"]);
  const referenceCount = await index.referenceCount(implementation, "Before");

  assert.deepEqual(completion.map((entry) => entry.label), ["Before"]);
  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].document.uri.fsPath, implementation.uri.fsPath);
  assert.equal(referenceCount, 1);
});

test("WorkspaceStepIndex refreshes unopened constant-backed aliases", async () => {
  const { WorkspaceStepIndex } = require("../src/workspaceStepIndex");
  const constantsPath = "/workspace/gauge/src/Constants.kt";
  const constants = createDocument([
    "package steps",
    "const val STEP_TEXT = \"Before\"",
  ].join("\n"), constantsPath, "kotlin");
  const implementation = createDocument([
    "package steps",
    "import com.thoughtworks.gauge.Step",
    "@Step(STEP_TEXT)",
    "fun run() {}",
  ].join("\n"), "/workspace/gauge/src/Steps.kt", "kotlin");
  const specification = createDocument("# Example\n*", "/workspace/gauge/specs/example.spec", "gauge", 1);
  const store = new FakeDocumentStore([constants, implementation, specification]);
  const index = new WorkspaceStepIndex({
    documentStore: store,
    projectFactory: createProjectFactory(),
    vscode: { workspace: { textDocuments: [specification] } },
  });

  assert.deepEqual((await index.completionEntries(specification)).map((entry) => entry.label), ["Before"]);

  store.replace(createDocument([
    "package steps",
    "const val STEP_TEXT = \"After\"",
  ].join("\n"), constantsPath, "kotlin"));

  const completion = await index.completionEntries(specification);
  const oldDefinitions = await index.definitionEntries(specification, ["Before"]);
  const newDefinitions = await index.definitionEntries(specification, ["After"]);

  assert.deepEqual(completion.map((entry) => entry.label), ["After"]);
  assert.deepEqual(oldDefinitions, []);
  assert.equal(newDefinitions.length, 1);
  assert.equal(newDefinitions[0].document.uri.fsPath, implementation.uri.fsPath);
});

test("WorkspaceStepIndex does not reanalyze unchanged queries", async () => {
  const { WorkspaceStepIndex } = require("../src/workspaceStepIndex");
  const implementation = createDocument(
    "@Step(\"Indexed step\")\nfun indexed() {}",
    "/workspace/gauge/src/Steps.kt",
    "kotlin",
  );
  const specification = createDocument(
    "# Example\n* Indexed step",
    "/workspace/gauge/specs/example.spec",
    "gauge",
    1,
  );
  const store = new FakeDocumentStore([implementation, specification]);
  let implementationAnalyses = 0;
  let referenceAnalyses = 0;
  const index = new WorkspaceStepIndex({
    documentStore: store,
    projectFactory: createProjectFactory(),
    stepEntriesProvider(document) {
      implementationAnalyses += 1;
      return [{ aliases: ["Indexed step"], declarationStart: 0, declarationEnd: 4 }];
    },
    referenceEntriesProvider(document) {
      referenceAnalyses += 1;
      return [{
        location: { uri: document.uri, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 14 } } },
        template: "Indexed step",
      }];
    },
    vscode: { workspace: { textDocuments: [specification] } },
  });

  await index.completionEntries(specification);
  await index.definitionEntries(specification, ["Indexed step"]);
  await index.referenceCount(implementation, "Indexed step");
  await index.completionEntries(specification);

  assert.equal(implementationAnalyses, 1);
  assert.equal(referenceAnalyses, 1);

  store.replace(createDocument(
    "# Example\n* Indexed step\n* Indexed step",
    specification.uri.fsPath,
    "gauge",
    2,
  ));
  assert.equal(await index.referenceCount(implementation, "Indexed step"), 1);
  assert.equal(implementationAnalyses, 1);
  assert.equal(referenceAnalyses, 2);
});

test("WorkspaceStepIndex excludes the current used step from position-aware completion", async () => {
  const { WorkspaceStepIndex } = require("../src/workspaceStepIndex");
  const specification = createDocument(
    "# Example\n* First step\n* Second step",
    "/workspace/gauge/specs/example.spec",
    "gauge",
    1,
  );
  const store = new FakeDocumentStore([specification]);
  const index = new WorkspaceStepIndex({
    documentStore: store,
    projectFactory: createProjectFactory(),
    vscode: { workspace: { textDocuments: [specification] } },
  });

  const entries = await index.completionEntries(specification, { line: 1, character: 12 });

  assert.deepEqual(entries.map((entry) => entry.label), ["Second step"]);
});

test("WorkspaceStepIndex reparses tags only for changed Gauge documents", async () => {
  const { WorkspaceStepIndex } = require("../src/workspaceStepIndex");
  const first = createDocument(
    "# First\ntags: smoke, fast",
    "/workspace/gauge/specs/first.spec",
    "gauge",
    1,
  );
  const second = createDocument(
    "# Second\ntags: regression",
    "/workspace/gauge/specs/second.spec",
    "gauge",
    1,
  );
  const store = new FakeDocumentStore([first, second]);
  let tagAnalyses = 0;
  const index = new WorkspaceStepIndex({
    documentStore: store,
    projectFactory: createProjectFactory(),
    tagEntriesProvider(document) {
      tagAnalyses += 1;
      return document.getText().match(/(?:smoke|fast|regression|focused)/g) || [];
    },
    vscode: { workspace: { textDocuments: [first] } },
  });

  assert.deepEqual(await index.tagEntries(first), ["smoke", "fast", "regression"]);
  assert.equal(tagAnalyses, 2);
  assert.deepEqual(await index.tagEntries(first), ["smoke", "fast", "regression"]);
  assert.equal(tagAnalyses, 2);

  store.replace(createDocument(
    "# Second\ntags: focused",
    second.uri.fsPath,
    "gauge",
    2,
  ));

  assert.deepEqual(await index.tagEntries(first), ["smoke", "fast", "focused"]);
  assert.equal(tagAnalyses, 3);
});

test("WorkspaceStepIndex caches parameter values and excludes the current step", async () => {
  const { WorkspaceStepIndex } = require("../src/workspaceStepIndex");
  const specification = createDocument([
    "# Checkout",
    "| customer | account |",
    "| Alice | primary |",
    "## Pay",
    "| method |",
    "| card |",
    "* Seed <tenant> for \"admin\"",
    "* Pay with <customer>",
  ].join("\n"), "/workspace/gauge/specs/checkout.spec", "gauge", 1);
  const store = new FakeDocumentStore([specification]);
  const index = new WorkspaceStepIndex({
    documentStore: store,
    projectFactory: createProjectFactory(),
    vscode: { workspace: { textDocuments: [specification] } },
  });

  assert.deepEqual(
    await index.parameterEntries(specification, { line: 7, character: 20 }, "dynamic"),
    ["customer", "account", "method", "tenant"],
  );
  assert.deepEqual(
    await index.parameterEntries(specification, { line: 6, character: 20 }, "static"),
    ["admin"],
  );
});
