"use strict";

const os = require("node:os");
const { performance } = require("node:perf_hooks");
const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
const { usedStepEntriesFromDocument } = require("../src/dynamicArgumentCompletion");
const { WorkspaceStepIndex } = require("../src/workspaceStepIndex");

const DOCUMENT_COUNT = 240;
const FILLER_LINES = 400;
const POSITION_AWARE_STEP_LINES = 10000;
const QUERY_COUNT = 80;

function document(text, fsPath) {
  const lines = text.split(/\r?\n/);
  return {
    languageId: "gauge",
    uri: { fsPath },
    getText() {
      return text;
    },
    lineAt(line) {
      return { text: lines[line] || "" };
    },
  };
}

function fixtureDocument(index) {
  return document([
    `# Specification ${index}`,
    ...Array.from({ length: FILLER_LINES }, () => "* A cached step"),
    `## Scenario ${index}`,
  ].join("\n"), `/workspace/gauge/specs/spec-${index}.spec`);
}

function median(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

async function timedSamples(run) {
  const samples = [];
  for (let sample = 0; sample < 7; sample += 1) {
    const start = performance.now();
    await run();
    samples.push(performance.now() - start);
  }
  return median(samples);
}

function projectFactory() {
  return {
    getGaugeRootFromFilePath() {
      return "/workspace/gauge";
    },
    isGaugeProject(root) {
      return root === "/workspace/gauge";
    },
  };
}

async function benchmarkPositionAwareCompletion() {
  const source = document([
    "# Completion benchmark",
    ...Array.from({ length: POSITION_AWARE_STEP_LINES }, () => "* Shared step"),
    "* Current step",
  ].join("\n"), "/workspace/gauge/specs/completion.spec");
  source.languageId = "gauge";
  let textReads = 0;
  const getText = source.getText.bind(source);
  source.getText = () => {
    textReads += 1;
    return getText();
  };
  const documentStore = {
    documents() {
      return [source];
    },
    onDidChangeDocuments() {
      return { dispose() {} };
    },
    start() {},
    async whenReady() {},
  };
  const index = new WorkspaceStepIndex({
    documentStore,
    projectFactory: projectFactory(),
    vscode: { workspace: { textDocuments: [source] } },
  });
  const position = { line: POSITION_AWARE_STEP_LINES + 1, character: 14 };

  await index.completionEntries(source);
  textReads = 0;
  const cachedMs = await timedSamples(async () => {
    for (let query = 0; query < QUERY_COUNT; query += 1) {
      const entries = await index.completionEntries(source, position);
      if (entries.length !== 1 || entries[0].label !== "Shared step") {
        throw new Error("cached position-aware completion returned unexpected entries");
      }
    }
  });
  const cachedTextReads = textReads;

  const scanActiveDocumentMs = await timedSamples(() => {
    for (let query = 0; query < QUERY_COUNT; query += 1) {
      usedStepEntriesFromDocument(source, {
        currentLine: position.line,
        includeCurrentLine: false,
      });
    }
  });

  if (cachedTextReads !== 0) {
    throw new Error(`warm completion read the active document ${cachedTextReads} times`);
  }
  return {
    activeStepLines: POSITION_AWARE_STEP_LINES + 1,
    cachedMs,
    cachedTextReads,
    scanActiveDocumentMs,
    speedup: scanActiveDocumentMs / cachedMs,
  };
}

async function benchmarkWorkspaceSymbols() {
  const listeners = [];
  let documents = Array.from({ length: DOCUMENT_COUNT }, (_value, index) => (
    fixtureDocument(index)
  ));
  const documentStore = {
    documents() {
      return documents;
    },
    onDidChangeDocuments(listener) {
      listeners.push(listener);
      return { dispose() {} };
    },
    async whenReady() {},
  };
  const provider = new GaugeDocumentSymbolProvider({
    documentStore,
    vscode: {},
  });
  const analyze = provider.provideDocumentSymbols.bind(provider);
  let analyses = 0;
  provider.provideDocumentSymbols = (candidate) => {
    analyses += 1;
    return analyze(candidate);
  };

  await provider.provideWorkspaceSymbols("Specification");
  const warmAnalyses = analyses;
  const cachedMs = await timedSamples(async () => {
    for (let query = 0; query < QUERY_COUNT; query += 1) {
      await provider.provideWorkspaceSymbols(query % 2 === 0 ? "Specification" : "Scenario");
    }
  });
  const unchangedReparses = analyses - warmAnalyses;

  const baselineMs = await timedSamples(() => {
    for (let query = 0; query < QUERY_COUNT; query += 1) {
      const queryText = query % 2 === 0 ? "specification" : "scenario";
      documents.flatMap((candidate) => analyze(candidate))
        .filter((symbol) => symbol.name.toLowerCase().includes(queryText));
    }
  });

  const changedPath = documents[Math.floor(DOCUMENT_COUNT / 2)].uri.fsPath;
  documents = documents.map((candidate, index) => (
    candidate.uri.fsPath === changedPath
      ? document("# Updated Specification\n## Updated Scenario", changedPath)
      : candidate
  ));
  listeners[0]({ file: changedPath });
  const analysesBeforeChange = analyses;
  await provider.provideWorkspaceSymbols("Updated");
  const changedReparses = analyses - analysesBeforeChange;

  if (unchangedReparses !== 0) {
    throw new Error(`unchanged workspace-symbol queries reparsed ${unchangedReparses} documents`);
  }
  if (changedReparses !== 1) {
    throw new Error(`one workspace-symbol change reparsed ${changedReparses} documents`);
  }

  return {
    cachedMs,
    changedReparses,
    documentCount: DOCUMENT_COUNT,
    fillerLinesPerDocument: FILLER_LINES,
    queryCount: QUERY_COUNT,
    scanEveryQueryMs: baselineMs,
    speedup: baselineMs / cachedMs,
    unchangedReparses,
  };
}

async function main() {
  const workspaceSymbols = await benchmarkWorkspaceSymbols();
  const positionAwareCompletion = await benchmarkPositionAwareCompletion();
  process.stdout.write(`${JSON.stringify({
    ...workspaceSymbols,
    machine: {
      arch: os.arch(),
      cpu: (os.cpus()[0] && os.cpus()[0].model) || "unknown",
      node: process.version,
      platform: os.platform(),
    },
    positionAwareCompletion,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.exitCode = 1;
  process.stderr.write(`${error.stack || error}\n`);
});
