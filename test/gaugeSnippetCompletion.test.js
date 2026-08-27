const assert = require("node:assert/strict");
const test = require("node:test");

function createFakeVscode() {
  const registrations = [];
  class CompletionItem {
    constructor(label, kind) {
      this.label = label;
      this.kind = kind;
    }
  }
  class SnippetString {
    constructor(value) {
      this.value = value;
    }
  }
  return {
    registrations,
    vscode: {
      CompletionItem,
      CompletionItemKind: { Snippet: 27 },
      SnippetString,
      languages: {
        registerCompletionItemProvider(selector, provider, ...triggers) {
          registrations.push({ selector, provider, triggers });
          return { dispose() {} };
        },
      },
    },
  };
}

function createDocument(fsPath, languageId = "markdown") {
  return {
    languageId,
    uri: { fsPath },
    getText() {
      return "";
    },
  };
}

function gaugeProjectFactory() {
  return {
    isGaugeProject: () => true,
    getGaugeRootFromFilePath: (file) => (
      String(file).startsWith("/workspace/gauge") ? "/workspace/gauge" : undefined
    ),
  };
}

test("GaugeSnippetCompletionProvider offers the contributed Gauge snippets", () => {
  const { GaugeSnippetCompletionProvider } = require("../src/gaugeSnippetCompletion");
  const { vscode } = createFakeVscode();
  const provider = new GaugeSnippetCompletionProvider({
    projectFactory: gaugeProjectFactory(),
    vscode,
  });

  const items = provider.provideCompletionItems(
    createDocument("/workspace/gauge/specs/checkout.md"),
  );
  const labels = items.map((item) => item.label);

  const snippets = require("../snippets/gauge.json");
  assert.deepEqual(
    labels.sort(),
    Object.values(snippets).map((snippet) => snippet.prefix).sort(),
  );
  const specification = items.find((item) => item.label === "spec");
  assert.equal(specification.kind, vscode.CompletionItemKind.Snippet);
  assert.equal(specification.insertText.value, snippets.Specification.body.join("\n"));
  assert.equal(specification.detail, snippets.Specification.description);
});

test("GaugeSnippetCompletionProvider stays out of Markdown outside a Gauge project", () => {
  const { GaugeSnippetCompletionProvider } = require("../src/gaugeSnippetCompletion");
  const { vscode } = createFakeVscode();
  const provider = new GaugeSnippetCompletionProvider({
    projectFactory: gaugeProjectFactory(),
    vscode,
  });

  assert.deepEqual(
    provider.provideCompletionItems(createDocument("/elsewhere/notes.md")),
    [],
  );
});

test("GaugeSnippetCompletionProvider stays out of Markdown outside the spec directories", () => {
  const { GaugeSnippetCompletionProvider } = require("../src/gaugeSnippetCompletion");
  const { vscode } = createFakeVscode();
  const provider = new GaugeSnippetCompletionProvider({
    fileSystem: {
      readFileSync() {
        throw new Error("no properties");
      },
    },
    projectFactory: gaugeProjectFactory(),
    vscode,
  });

  assert.deepEqual(
    provider.provideCompletionItems(createDocument("/workspace/gauge/README.md")),
    [],
  );
});

test("GaugeSnippetCompletionProvider serves Gauge and concept documents directly", () => {
  const { GaugeSnippetCompletionProvider } = require("../src/gaugeSnippetCompletion");
  const { vscode } = createFakeVscode();
  const provider = new GaugeSnippetCompletionProvider({ vscode });

  assert.ok(
    provider.provideCompletionItems(
      createDocument("/workspace/gauge/specs/checkout.spec", "gauge"),
    ).length > 0,
  );
  assert.ok(
    provider.provideCompletionItems(
      createDocument("/workspace/gauge/specs/concepts/login.cpt", "gauge-concept"),
    ).length > 0,
  );
});

test("GaugeSnippetCompletionProvider registers for Gauge documents only", () => {
  const { GaugeSnippetCompletionProvider } = require("../src/gaugeSnippetCompletion");
  const { registrations, vscode } = createFakeVscode();
  const provider = new GaugeSnippetCompletionProvider({ vscode });

  provider.register();

  assert.equal(registrations.length, 1);
  assert.deepEqual(registrations[0].selector, [
    { language: "gauge" },
    { language: "gauge-concept" },
    { scheme: "file", pattern: "**/*.spec" },
    { scheme: "file", pattern: "**/*.cpt" },
    { language: "markdown", scheme: "file", pattern: "**/*.md" },
  ]);
});

// The provider must read gauge_specs_dir exactly as src/stepDiagnostics.js does,
// escapes included, or the same project property would decide differently
// depending on which provider asked.
test("GaugeSnippetCompletionProvider follows a configured gauge_specs_dir", () => {
  const { GaugeSnippetCompletionProvider } = require("../src/gaugeSnippetCompletion");
  const { vscode } = createFakeVscode();
  const provider = new GaugeSnippetCompletionProvider({
    fileSystem: {
      readFileSync(filename) {
        assert.equal(filename, "/workspace/gauge/env/default/default.properties");
        return "gauge_specs_dir = anotherSpecDir\n";
      },
    },
    pathModule: require("node:path").posix,
    projectFactory: gaugeProjectFactory(),
    vscode,
  });

  assert.ok(
    provider.provideCompletionItems(
      createDocument("/workspace/gauge/anotherSpecDir/checkout.md"),
    ).length > 0,
  );
  assert.deepEqual(
    provider.provideCompletionItems(createDocument("/workspace/gauge/specs/checkout.md")),
    [],
  );
});

test("GaugeSnippetCompletionProvider reads a property whose value contains an escaped separator", () => {
  const { GaugeSnippetCompletionProvider } = require("../src/gaugeSnippetCompletion");
  const { vscode } = createFakeVscode();
  const provider = new GaugeSnippetCompletionProvider({
    fileSystem: {
      readFileSync() {
        return "gauge_specs_dir = spec\\=dir\n";
      },
    },
    pathModule: require("node:path").posix,
    projectFactory: gaugeProjectFactory(),
    vscode,
  });

  assert.ok(
    provider.provideCompletionItems(
      createDocument("/workspace/gauge/spec=dir/checkout.md"),
    ).length > 0,
  );
});
