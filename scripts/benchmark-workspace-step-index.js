"use strict";

const os = require("node:os");
const { performance } = require("node:perf_hooks");

const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
const { GaugeDynamicArgumentCompletionProvider } = require("../src/dynamicArgumentCompletion");
const { GaugeStepDefinitionProvider } = require("../src/stepDefinitionProvider");
const { WorkspaceStepIndex } = require("../src/workspaceStepIndex");

const INPUT_SIZES = [60, 120, 240];
const MAX_DOUBLING_RATIO = 2.5;
const SAMPLE_COUNT = 7;

function createDocument(text, fsPath, languageId) {
  const lines = text.split(/\r?\n/);
  return {
    languageId,
    version: 1,
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

class FixtureDocumentStore {
  constructor(documents) {
    this.fixtureDocuments = documents;
    this.listeners = new Set();
  }

  documents() {
    return this.fixtureDocuments;
  }

  isScanComplete() {
    return true;
  }

  onDidChangeDocuments(listener) {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  start() {}

  async whenReady() {}
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

function createVscode(documents) {
  return {
    CompletionItem: class CompletionItem {
      constructor(label, kind) {
        this.label = label;
        this.kind = kind;
      }
    },
    CompletionItemKind: { Function: 1 },
    Location: class Location {
      constructor(uri, range) {
        this.uri = uri;
        this.range = range;
      }
    },
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
    SnippetString: class SnippetString {
      constructor(value) {
        this.value = value;
      }
    },
    workspace: {
      getConfiguration() {
        return { get() { return undefined; } };
      },
      textDocuments: documents,
    },
  };
}

function fixtureIndexFromPath(document) {
  const match = /(?:Step|example)(\d+)\.(?:kt|spec)$/.exec(document.uri.fsPath);
  return match ? Number(match[1]) : 0;
}

function createFixture(size) {
  const implementations = [];
  const specifications = [];
  for (let index = 0; index < size; index += 1) {
    implementations.push(createDocument(
      `@Step("Step ${index}")\nfun step${index}() {}`,
      `/workspace/gauge/src/Step${index}.kt`,
      "kotlin",
    ));
    specifications.push(createDocument(
      "# Example\n* Step 0",
      `/workspace/gauge/specs/example${index}.spec`,
      "gauge",
    ));
  }
  const documents = [...implementations, ...specifications];
  const documentStore = new FixtureDocumentStore(documents);
  const projectFactory = createProjectFactory();
  const vscode = createVscode(documents);
  const workspaceStepIndex = new WorkspaceStepIndex({
    documentStore,
    projectFactory,
    referenceEntriesProvider(document) {
      return [{
        kind: "step",
        location: {
          range: {
            end: { line: 1, character: 8 },
            start: { line: 1, character: 0 },
          },
          uri: document.uri,
        },
        template: "Step 0",
      }];
    },
    stepEntriesProvider(document) {
      const index = fixtureIndexFromPath(document);
      return [{
        aliases: [`Step ${index}`],
        annotationEnd: 15,
        annotationStart: 0,
        declarationEnd: document.getText().length,
        declarationStart: 0,
        parameterEnd: 14,
        parameterStart: 6,
      }];
    },
    vscode,
  });
  const completionProvider = new GaugeDynamicArgumentCompletionProvider({
    projectFactory,
    vscode,
    workspaceStepIndex,
  });
  const definitionProvider = new GaugeStepDefinitionProvider({
    projectFactory,
    vscode,
    workspaceStepIndex,
  });
  const codeLensProvider = new GaugeCodeLensProvider({
    projectFactory,
    vscode,
    workspaceStepIndex,
  });
  const specification = specifications[0];
  const implementation = implementations[0];
  const position = new vscode.Position(1, 8);
  return {
    async codeLens() {
      const result = await codeLensProvider.provideCodeLenses(implementation);
      if (result.length !== 1 || result[0].command.title !== `${size} reference(s)`) {
        throw new Error(`unexpected CodeLens result for ${size} inputs`);
      }
    },
    async completion() {
      const result = await completionProvider.provideCompletionItems(specification, position);
      if (result.length !== size) {
        throw new Error(`unexpected completion result for ${size} inputs`);
      }
    },
    async definition() {
      const result = await definitionProvider.provideDefinition(specification, position);
      if (result.length !== 1) {
        throw new Error(`unexpected definition result for ${size} inputs`);
      }
    },
  };
}

function median(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

async function measure(operation, repetitions) {
  for (let index = 0; index < 25; index += 1) {
    await operation();
  }
  const samples = [];
  for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
    const started = performance.now();
    for (let index = 0; index < repetitions; index += 1) {
      await operation();
    }
    samples.push(performance.now() - started);
  }
  return median(samples);
}

function ratios(results, field) {
  const values = [];
  for (let index = 1; index < results.length; index += 1) {
    values.push(results[index][field] / results[index - 1][field]);
  }
  return values;
}

async function main() {
  const results = [];
  for (const size of INPUT_SIZES) {
    const fixture = createFixture(size);
    results.push({
      codeLensMs: await measure(fixture.codeLens, 1200),
      completionMs: await measure(fixture.completion, 400),
      definitionMs: await measure(fixture.definition, 2400),
      size,
    });
  }
  const report = {
    machine: {
      arch: process.arch,
      cpu: (os.cpus()[0] && os.cpus()[0].model) || "unknown",
      node: process.version,
      platform: process.platform,
    },
    maxDoublingRatio: MAX_DOUBLING_RATIO,
    ratios: {
      codeLens: ratios(results, "codeLensMs"),
      completion: ratios(results, "completionMs"),
      definition: ratios(results, "definitionMs"),
    },
    repetitions: {
      codeLens: 1200,
      completion: 400,
      definition: 2400,
    },
    results,
    samples: SAMPLE_COUNT,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  for (const [provider, providerRatios] of Object.entries(report.ratios)) {
    for (const ratio of providerRatios) {
      if (ratio >= MAX_DOUBLING_RATIO) {
        throw new Error(`${provider} doubling ratio ${ratio.toFixed(3)} exceeds ${MAX_DOUBLING_RATIO}`);
      }
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
