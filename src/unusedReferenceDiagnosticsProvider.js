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

function disposeSafely(disposable) {
  if (!disposable || typeof disposable.dispose !== "function") {
    return;
  }
  try {
    disposable.dispose();
  } catch (_error) {
    // Continue disposing the remaining provider-owned resources.
  }
}

class GaugeUnusedReferenceDiagnosticsProvider {
  constructor(options = {}) {
    this.documentStore = options.documentStore;
    this.refreshDelayMs = options.refreshDelayMs === undefined ? 150 : options.refreshDelayMs;
    this.vscode = getVscode(options.vscode);
    this.workspaceStepIndex = options.workspaceStepIndex;
    this.activeRefreshes = new Set();
    this.disposed = false;
    this.pendingRefreshPromise = undefined;
    this.registrationDisposables = undefined;
    this.refreshGeneration = 0;
    this.refreshTimer = undefined;
  }

  async conceptDiagnostics(document) {
    if (
      this.disposed
      ||
      !this.workspaceStepIndex
      || typeof this.workspaceStepIndex.referenceCount !== "function"
    ) {
      return [];
    }
    const headings = findConceptHeadings(document.getText())
      .filter((heading) => Boolean(heading.normalized));
    if (this.disposed) {
      return [];
    }
    const countPromises = [];
    try {
      for (const heading of headings) {
        if (this.disposed) {
          break;
        }
        countPromises.push(Promise.resolve(
          this.workspaceStepIndex.referenceCount(document, heading.normalized),
        ));
      }
      const counts = await Promise.all(countPromises);
      if (this.disposed || counts.length !== headings.length) {
        return [];
      }
      const diagnostics = [];
      for (let index = 0; index < headings.length; index += 1) {
        if (this.disposed) {
          return [];
        }
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
      return this.disposed ? [] : diagnostics;
    } catch (error) {
      if (this.disposed) {
        return [];
      }
      throw error;
    }
  }

  async stepImplementationDiagnostics(document) {
    if (
      this.disposed
      ||
      !this.workspaceStepIndex
      || typeof this.workspaceStepIndex.stepEntriesForDocument !== "function"
      || typeof this.workspaceStepIndex.stepAliasesForEntry !== "function"
      || typeof this.workspaceStepIndex.referenceCount !== "function"
    ) {
      return [];
    }
    const text = document.getText();
    if (this.disposed) {
      return [];
    }
    try {
      const entries = await this.workspaceStepIndex.stepEntriesForDocument(document, document);
      if (this.disposed) {
        return [];
      }
      const diagnostics = [];
      for (const entry of entries || []) {
        if (this.disposed) {
          return [];
        }
        const aliases = uniqueNonEmpty(
          await this.workspaceStepIndex.stepAliasesForEntry(document, document, entry),
        );
        if (this.disposed) {
          return [];
        }
        if (aliases.length === 0) {
          continue;
        }
        const countPromises = [];
        for (const alias of aliases) {
          if (this.disposed) {
            break;
          }
          countPromises.push(Promise.resolve(
            this.workspaceStepIndex.referenceCount(document, alias),
          ));
        }
        const counts = await Promise.all(countPromises);
        if (this.disposed) {
          return [];
        }
        if (counts.length !== aliases.length || !counts.every((count) => count === 0)) {
          continue;
        }
        const start = positionAt(text, entry.declarationStart, document);
        if (this.disposed) {
          return [];
        }
        const end = positionAt(text, entry.declarationEnd, document);
        if (this.disposed) {
          return [];
        }
        diagnostics.push(createUnusedDiagnostic(
          this.vscode,
          createRange(this.vscode, start, end),
          UNUSED_STEP_IMPLEMENTATION_MESSAGE,
          UNUSED_STEP_IMPLEMENTATION_CODE,
        ));
      }
      return this.disposed ? [] : diagnostics;
    } catch (error) {
      if (this.disposed) {
        return [];
      }
      throw error;
    }
  }

  async provideDiagnostics(document) {
    if (
      this.disposed
      || !document
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
    if (this.disposed) {
      return;
    }
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
      if (this.disposed || generation !== this.refreshGeneration) {
        return;
      }
      if (this.isStillOpen(document)) {
        if (this.disposed || generation !== this.refreshGeneration) {
          return;
        }
        collection.set(document.uri, diagnostics);
      }
    }
  }

  scheduleRefresh(collection) {
    if (this.disposed) {
      return Promise.resolve();
    }
    this.refreshGeneration += 1;
    if (this.refreshTimer !== undefined) {
      return this.pendingRefreshPromise;
    }
    const refresh = {
      promise: undefined,
      resolve: undefined,
      settled: false,
      started: false,
      timer: undefined,
    };
    refresh.promise = new Promise((resolve) => {
      refresh.resolve = resolve;
    });
    this.activeRefreshes.add(refresh);
    this.pendingRefreshPromise = refresh.promise;
    const run = async () => {
      refresh.started = true;
      if (this.refreshTimer === refresh.timer || refresh.timer === undefined) {
        this.refreshTimer = undefined;
      }
      const generation = this.refreshGeneration;
      try {
        if (!this.disposed) {
          await this.performRefresh(collection, generation);
        }
      } finally {
        this.settleRefresh(refresh);
      }
    };
    const timer = setTimeout(run, this.refreshDelayMs);
    refresh.timer = timer;
    if (!refresh.started && !this.disposed) {
      this.refreshTimer = timer;
      if (timer && typeof timer.unref === "function") {
        timer.unref();
      }
    } else if (!refresh.started) {
      clearTimeout(timer);
      this.settleRefresh(refresh);
    }
    return refresh.promise;
  }

  settleRefresh(refresh) {
    if (!refresh || refresh.settled) {
      return;
    }
    refresh.settled = true;
    this.activeRefreshes.delete(refresh);
    if (this.pendingRefreshPromise === refresh.promise) {
      this.pendingRefreshPromise = undefined;
    }
    refresh.resolve();
  }

  waitForPendingRefresh() {
    return this.pendingRefreshPromise || Promise.resolve();
  }

  register() {
    if (this.disposed || this.registrationDisposables !== undefined) {
      return this;
    }
    const languages = this.vscode.languages || {};
    if (typeof languages.createDiagnosticCollection !== "function") {
      this.registrationDisposables = [];
      return this;
    }
    this.registrationDisposables = [];
    try {
      const collection = languages.createDiagnosticCollection(COLLECTION_NAME);
      if (this.disposed) {
        disposeSafely(collection);
        return this;
      }
      this.registrationDisposables.push(collection);
      const workspace = this.vscode.workspace || {};
      const schedule = () => this.scheduleRefresh(collection);

      if (
        this.documentStore
        && typeof this.documentStore.onDidChangeDocuments === "function"
      ) {
        const subscription = this.documentStore.onDidChangeDocuments(schedule);
        if (this.disposed) {
          disposeSafely(subscription);
          return this;
        }
        this.registrationDisposables.push(subscription);
        if (typeof this.documentStore.start === "function") {
          this.documentStore.start();
          if (this.disposed) {
            return this;
          }
        }
      } else {
        if (typeof workspace.onDidOpenTextDocument === "function") {
          const subscription = workspace.onDidOpenTextDocument(schedule);
          if (this.disposed) {
            disposeSafely(subscription);
            return this;
          }
          this.registrationDisposables.push(subscription);
        }
        if (typeof workspace.onDidChangeTextDocument === "function") {
          const subscription = workspace.onDidChangeTextDocument(schedule);
          if (this.disposed) {
            disposeSafely(subscription);
            return this;
          }
          this.registrationDisposables.push(subscription);
        }
      }
      if (typeof workspace.onDidCloseTextDocument === "function") {
        const subscription = workspace.onDidCloseTextDocument((document) => {
          if (this.disposed) {
            return;
          }
          if (document && document.uri && typeof collection.delete === "function") {
            collection.delete(document.uri);
          }
          if (this.disposed) {
            return;
          }
          schedule();
        });
        if (this.disposed) {
          disposeSafely(subscription);
          return this;
        }
        this.registrationDisposables.push(subscription);
      }

      schedule();
      return this;
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.refreshGeneration += 1;
    const timer = this.refreshTimer;
    this.refreshTimer = undefined;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    this.pendingRefreshPromise = undefined;
    const refreshes = [...this.activeRefreshes];
    this.activeRefreshes.clear();
    for (const refresh of refreshes) {
      this.settleRefresh(refresh);
    }
    const disposables = this.registrationDisposables || [];
    this.registrationDisposables = undefined;
    for (const disposable of disposables) {
      disposeSafely(disposable);
    }
  }
}

module.exports = {
  COLLECTION_NAME,
  GaugeUnusedReferenceDiagnosticsProvider,
};
