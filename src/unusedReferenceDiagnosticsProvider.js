"use strict";

const {
  findConceptHeadings,
  isConceptDocument,
  isStepImplementationDocument,
  positionAt,
} = require("./stepDiagnostics");

const COLLECTION_NAME = "gauge-unused-references";
const DIAGNOSTIC_SOURCE = "gauge";
const UNUSED_CONCEPT_CODE = "gauge.unusedConcept";
const UNUSED_CONCEPT_MESSAGE = "Concept has no references.";
const UNUSED_STEP_IMPLEMENTATION_CODE = "gauge.unusedStepImplementation";
const UNUSED_STEP_IMPLEMENTATION_MESSAGE = "Step implementation has no references.";

function getVscode(vscode) {
  return vscode || require("vscode");
}

function documentPath(document) {
  const uri = document && document.uri;
  return (uri && (uri.fsPath || uri.path)) || (document && document.fileName) || "";
}

function isFileDocument(document) {
  const scheme = document && document.uri && document.uri.scheme;
  return !scheme || scheme === "file";
}

function createPosition(vscode, line, character) {
  return typeof vscode.Position === "function"
    ? new vscode.Position(line, character)
    : { line, character };
}

function createRange(vscode, start, end) {
  const startPosition = createPosition(vscode, start.line, start.character);
  const endPosition = createPosition(vscode, end.line, end.character);
  return typeof vscode.Range === "function"
    ? new vscode.Range(startPosition, endPosition)
    : { start: startPosition, end: endPosition };
}

function createUnusedDiagnostic(vscode, range, message, code) {
  const severity = vscode.DiagnosticSeverity && vscode.DiagnosticSeverity.Hint;
  const diagnostic = typeof vscode.Diagnostic === "function"
    ? new vscode.Diagnostic(range, message, severity)
    : { range, message, severity };
  diagnostic.code = code;
  diagnostic.source = DIAGNOSTIC_SOURCE;
  diagnostic.tags = [vscode.DiagnosticTag && vscode.DiagnosticTag.Unnecessary];
  return diagnostic;
}

function uniqueNonEmpty(values) {
  return [...new Set((values || []).filter((value) => String(value || "").trim().length > 0))];
}

class GaugeUnusedReferenceDiagnosticsProvider {
  constructor(options = {}) {
    this.documentStore = options.documentStore;
    this.refreshDelayMs = options.refreshDelayMs === undefined ? 150 : options.refreshDelayMs;
    this.vscode = getVscode(options.vscode);
    this.workspaceStepIndex = options.workspaceStepIndex;
    this.disposed = false;
    this.pendingRefreshPromise = undefined;
    this.pendingRefreshResolve = undefined;
    this.refreshGeneration = 0;
    this.refreshTimer = undefined;
  }

  async conceptDiagnostics(document) {
    if (
      !this.workspaceStepIndex
      || typeof this.workspaceStepIndex.referenceCount !== "function"
    ) {
      return [];
    }
    const headings = findConceptHeadings(document.getText())
      .filter((heading) => Boolean(heading.normalized));
    const counts = await Promise.all(headings.map((heading) => (
      this.workspaceStepIndex.referenceCount(document, heading.normalized)
    )));
    const diagnostics = [];
    for (let index = 0; index < headings.length; index += 1) {
      if (counts[index] !== 0) {
        continue;
      }
      const heading = headings[index];
      diagnostics.push(createUnusedDiagnostic(
        this.vscode,
        createRange(this.vscode, heading.start, heading.end),
        UNUSED_CONCEPT_MESSAGE,
        UNUSED_CONCEPT_CODE,
      ));
    }
    return diagnostics;
  }

  async stepImplementationDiagnostics(document) {
    if (
      !this.workspaceStepIndex
      || typeof this.workspaceStepIndex.stepEntriesForDocument !== "function"
      || typeof this.workspaceStepIndex.stepAliasesForEntry !== "function"
      || typeof this.workspaceStepIndex.referenceCount !== "function"
    ) {
      return [];
    }
    const text = document.getText();
    const entries = await this.workspaceStepIndex.stepEntriesForDocument(document, document);
    const diagnostics = [];
    for (const entry of entries || []) {
      const aliases = uniqueNonEmpty(
        await this.workspaceStepIndex.stepAliasesForEntry(document, document, entry),
      );
      if (aliases.length === 0) {
        continue;
      }
      const counts = await Promise.all(aliases.map((alias) => (
        this.workspaceStepIndex.referenceCount(document, alias)
      )));
      if (!counts.every((count) => count === 0)) {
        continue;
      }
      const start = positionAt(text, entry.declarationStart, document);
      const end = positionAt(text, entry.declarationEnd, document);
      diagnostics.push(createUnusedDiagnostic(
        this.vscode,
        createRange(this.vscode, start, end),
        UNUSED_STEP_IMPLEMENTATION_MESSAGE,
        UNUSED_STEP_IMPLEMENTATION_CODE,
      ));
    }
    return diagnostics;
  }

  async provideDiagnostics(document) {
    if (
      !document
      || !document.uri
      || typeof document.getText !== "function"
      || !isFileDocument(document)
    ) {
      return [];
    }
    if (isConceptDocument(document)) {
      return this.conceptDiagnostics(document);
    }
    if (isStepImplementationDocument(document)) {
      return this.stepImplementationDiagnostics(document);
    }
    return [];
  }

  supportedOpenDocuments() {
    const workspace = this.vscode.workspace || {};
    return (workspace.textDocuments || []).filter((document) => (
      isFileDocument(document)
      && (isConceptDocument(document) || isStepImplementationDocument(document))
    ));
  }

  isStillOpen(document) {
    const file = documentPath(document);
    return this.supportedOpenDocuments().some((candidate) => (
      candidate === document || (file && documentPath(candidate) === file)
    ));
  }

  async performRefresh(collection, generation) {
    const updates = await Promise.all(this.supportedOpenDocuments().map(async (document) => {
      try {
        return { diagnostics: await this.provideDiagnostics(document), document };
      } catch (_error) {
        return { diagnostics: [], document };
      }
    }));
    if (this.disposed || generation !== this.refreshGeneration) {
      return;
    }
    for (const { diagnostics, document } of updates) {
      if (this.isStillOpen(document)) {
        collection.set(document.uri, diagnostics);
      }
    }
  }

  scheduleRefresh(collection) {
    this.refreshGeneration += 1;
    if (this.refreshTimer !== undefined) {
      return this.pendingRefreshPromise;
    }
    const pending = new Promise((resolve) => {
      this.pendingRefreshResolve = resolve;
      this.refreshTimer = setTimeout(async () => {
        this.refreshTimer = undefined;
        const generation = this.refreshGeneration;
        try {
          await this.performRefresh(collection, generation);
        } finally {
          if (this.pendingRefreshPromise === pending) {
            this.pendingRefreshPromise = undefined;
            this.pendingRefreshResolve = undefined;
          }
          resolve();
        }
      }, this.refreshDelayMs);
      if (this.refreshTimer && typeof this.refreshTimer.unref === "function") {
        this.refreshTimer.unref();
      }
    });
    this.pendingRefreshPromise = pending;
    return pending;
  }

  waitForPendingRefresh() {
    return this.pendingRefreshPromise || Promise.resolve();
  }

  register() {
    const languages = this.vscode.languages || {};
    if (typeof languages.createDiagnosticCollection !== "function") {
      return { dispose() {} };
    }
    const collection = languages.createDiagnosticCollection(COLLECTION_NAME);
    const workspace = this.vscode.workspace || {};
    const disposables = [collection];
    const schedule = () => this.scheduleRefresh(collection);

    if (
      this.documentStore
      && typeof this.documentStore.onDidChangeDocuments === "function"
    ) {
      disposables.push(this.documentStore.onDidChangeDocuments(schedule));
      if (typeof this.documentStore.start === "function") {
        this.documentStore.start();
      }
    } else {
      if (typeof workspace.onDidOpenTextDocument === "function") {
        disposables.push(workspace.onDidOpenTextDocument(schedule));
      }
      if (typeof workspace.onDidChangeTextDocument === "function") {
        disposables.push(workspace.onDidChangeTextDocument(schedule));
      }
    }
    if (typeof workspace.onDidCloseTextDocument === "function") {
      disposables.push(workspace.onDidCloseTextDocument((document) => {
        if (document && document.uri && typeof collection.delete === "function") {
          collection.delete(document.uri);
        }
        schedule();
      }));
    }

    schedule();
    const provider = this;
    return {
      dispose() {
        provider.disposed = true;
        provider.refreshGeneration += 1;
        if (provider.refreshTimer !== undefined) {
          clearTimeout(provider.refreshTimer);
          provider.refreshTimer = undefined;
        }
        if (provider.pendingRefreshResolve) {
          provider.pendingRefreshResolve();
          provider.pendingRefreshResolve = undefined;
          provider.pendingRefreshPromise = undefined;
        }
        for (const disposable of disposables) {
          if (disposable && typeof disposable.dispose === "function") {
            disposable.dispose();
          }
        }
      },
    };
  }
}

module.exports = {
  COLLECTION_NAME,
  GaugeUnusedReferenceDiagnosticsProvider,
};
