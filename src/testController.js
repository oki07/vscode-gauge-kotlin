"use strict";

const { headingMarkers } = require("./codeLensProvider");

const CONTROLLER_ID = "gauge";
const CONTROLLER_LABEL = "Gauge";
const GAUGE_LANGUAGE = "gauge";
const RUN_PROFILE_LABEL = "Run";
const ROOT_PARENT_ID = "suite";
const TEST_UI_RUN_FLAGS = {
  "hide-suggestion": true,
  "machine-readable": true,
};

function getVscode(vscode) {
  return vscode || require("vscode");
}

function collectionAdd(collection, item) {
  if (collection && typeof collection.add === "function") {
    collection.add(item);
  }
}

function collectionDelete(collection, id) {
  if (collection && typeof collection.delete === "function") {
    collection.delete(id);
  }
}

function addDisposable(disposables, disposable) {
  if (disposable && typeof disposable.dispose === "function") {
    disposables.push(disposable);
  }
}

function parseGaugeLocation(location) {
  const match = /^gauge:\/\/(.+):(\d+)$/.exec(String(location || ""));
  if (!match) {
    return undefined;
  }
  return {
    file: match[1],
    line: Math.max(0, Number.parseInt(match[2], 10) - 1),
  };
}

function createPosition(vscode, line, character) {
  return typeof vscode.Position === "function"
    ? new vscode.Position(line, character)
    : { line, character };
}

function createRange(vscode, line, startCharacter = 0, endCharacter = 0) {
  const start = createPosition(vscode, line, startCharacter);
  const end = createPosition(vscode, line, endCharacter);
  return typeof vscode.Range === "function"
    ? new vscode.Range(start, end)
    : { start, end };
}

function documentPath(document) {
  const uri = document && document.uri;
  return (uri && (uri.fsPath || uri.path)) || (document && document.fileName) || "";
}

function isConceptDocument(document) {
  return documentPath(document).toLowerCase().endsWith(".cpt");
}

function isGaugeSpecificationDocument(document) {
  return Boolean(
    document
    && document.languageId === GAUGE_LANGUAGE
    && !isConceptDocument(document)
    && documentPath(document),
  );
}

function documentLine(document, line) {
  if (typeof document.lineAt === "function") {
    return document.lineAt(line).text;
  }
  if (typeof document.getText === "function") {
    return String(document.getText()).split(/\r?\n/)[line] || "";
  }
  return "";
}

function itemUri(vscode, location) {
  const parsed = parseGaugeLocation(location);
  if (!parsed || !vscode.Uri || typeof vscode.Uri.file !== "function") {
    return undefined;
  }
  return vscode.Uri.file(parsed.file);
}

function fileUri(vscode, filename) {
  if (!vscode.Uri || typeof vscode.Uri.file !== "function") {
    return undefined;
  }
  return vscode.Uri.file(filename);
}

function applyLocation(vscode, item, location) {
  const parsed = parseGaugeLocation(location);
  if (!parsed) {
    return item;
  }
  if (vscode.Range || vscode.Position) {
    item.range = createRange(vscode, parsed.line);
  }
  return item;
}

function createMessage(vscode, message) {
  if (typeof vscode.TestMessage === "function") {
    return new vscode.TestMessage(message || "");
  }
  return message || "";
}

function notificationText(event) {
  const title = String((event && event.title) || "").trim();
  const message = String((event && event.message) || "").trim();
  if (title && message) {
    return `${title}: ${message}`;
  }
  return title || message;
}

function notificationMethod(severity) {
  const normalized = String(severity || "").toLowerCase();
  if (normalized === "error") {
    return "showErrorMessage";
  }
  if (normalized === "warning" || normalized === "warn") {
    return "showWarningMessage";
  }
  return "showInformationMessage";
}

function headingLabel(document, marker) {
  const line = documentLine(document, marker.line).slice(marker.start, marker.end).trim();
  return line.replace(/^#+[ \t]*/, "").trim();
}

function markerId(filename, marker) {
  return marker.kind === "scenario" ? `${filename}:${marker.line + 1}` : filename;
}

function markerRange(vscode, marker) {
  return createRange(vscode, marker.line, marker.start, marker.end);
}

function executionTargetForItem(item) {
  return item && item.id;
}

function testUiRunFlags() {
  return { ...TEST_UI_RUN_FLAGS };
}

class GaugeTestController {
  constructor(options = {}) {
    this.vscode = getVscode(options.vscode);
    this.executionController = options.executionController;
    this.controller = undefined;
    this.currentRun = undefined;
    this.items = new Map();
    this.pendingResults = new Map();
  }

  register() {
    if (!this.vscode.tests || typeof this.vscode.tests.createTestController !== "function") {
      return undefined;
    }
    this.controller = this.vscode.tests.createTestController(CONTROLLER_ID, CONTROLLER_LABEL);
    if (typeof this.controller.createRunProfile === "function") {
      const kind = this.vscode.TestRunProfileKind && this.vscode.TestRunProfileKind.Run;
      this.controller.createRunProfile(
        RUN_PROFILE_LABEL,
        kind,
        (request, token) => this.run(request, token),
        true,
      );
    }
    const disposables = this.registerDocumentDiscovery();
    this.discoverOpenDocuments();
    return {
      dispose: () => {
        for (const disposable of disposables) {
          disposable.dispose();
        }
        if (this.controller && typeof this.controller.dispose === "function") {
          this.controller.dispose();
        }
      },
    };
  }

  registerDocumentDiscovery() {
    const workspace = this.vscode.workspace || {};
    const disposables = [];
    if (typeof workspace.onDidOpenTextDocument === "function") {
      addDisposable(disposables, workspace.onDidOpenTextDocument((document) => {
        this.discoverDocument(document);
      }));
    }
    if (typeof workspace.onDidChangeTextDocument === "function") {
      addDisposable(disposables, workspace.onDidChangeTextDocument((event) => {
        this.discoverDocument(event && event.document);
      }));
    }
    if (typeof workspace.onDidSaveTextDocument === "function") {
      addDisposable(disposables, workspace.onDidSaveTextDocument((document) => {
        this.discoverDocument(document);
      }));
    }
    if (typeof workspace.onDidCloseTextDocument === "function") {
      addDisposable(disposables, workspace.onDidCloseTextDocument((document) => {
        this.removeDocumentItems(document);
      }));
    }
    return disposables;
  }

  discoverOpenDocuments() {
    const workspace = this.vscode.workspace || {};
    const documents = Array.isArray(workspace.textDocuments) ? workspace.textDocuments : [];
    for (const document of documents) {
      this.discoverDocument(document);
    }
  }

  removeDocumentItems(document, keepIds = new Set()) {
    const filename = documentPath(document);
    if (!filename) {
      return;
    }
    for (const [id] of [...this.items]) {
      if ((id === filename || id.startsWith(`${filename}:`)) && !keepIds.has(id)) {
        collectionDelete(this.controller && this.controller.items, id);
        for (const item of this.items.values()) {
          collectionDelete(item && item.children, id);
        }
        this.items.delete(id);
      }
    }
  }

  upsertItem(id, label, uri, range, parentId) {
    if (!id || !this.controller) {
      return undefined;
    }
    let item = this.items.get(id);
    if (!item) {
      item = this.controller.createTestItem(id, label || id, uri);
      this.items.set(id, item);
    } else if (label && label !== id) {
      item.label = label;
    }
    if (range) {
      item.range = range;
    }

    if (parentId && parentId !== ROOT_PARENT_ID) {
      const parent = this.upsertItem(parentId, parentId);
      collectionAdd(parent && parent.children, item);
    } else {
      collectionAdd(this.controller.items, item);
    }
    return item;
  }

  discoverDocument(document) {
    if (!this.controller || !isGaugeSpecificationDocument(document)) {
      return [];
    }
    const filename = documentPath(document);
    const uri = fileUri(this.vscode, filename);
    const discoveredIds = new Set();
    const discoveredItems = [];
    let currentSpecId;

    for (const marker of headingMarkers(document)) {
      const id = markerId(filename, marker);
      const label = headingLabel(document, marker);
      const parentId = marker.kind === "scenario" ? currentSpecId : undefined;
      const item = this.upsertItem(id, label, uri, markerRange(this.vscode, marker), parentId);
      discoveredIds.add(id);
      if (item) {
        discoveredItems.push(item);
      }
      if (marker.kind === "specification") {
        currentSpecId = id;
      }
    }

    this.removeDocumentItems(document, discoveredIds);
    return discoveredItems;
  }

  setExecutionController(executionController) {
    this.executionController = executionController;
  }

  createExecutionEventSink() {
    return (event) => this.handleExecutionEvent(event);
  }

  startTestRun(request = {}) {
    if (!this.controller || typeof this.controller.createTestRun !== "function") {
      return undefined;
    }
    this.currentRun = this.controller.createTestRun(request);
    this.pendingResults.clear();
    return this.currentRun;
  }

  async run(request = {}) {
    const run = this.startTestRun(request);
    try {
      if (this.executionController && typeof this.executionController.handleCommand === "function") {
        const targets = Array.isArray(request.include)
          ? request.include.map(executionTargetForItem).filter(Boolean)
          : [];
        if (targets.length === 0) {
          await this.executionController.handleCommand(
            "gauge.execute.specification.all",
            undefined,
            testUiRunFlags(),
          );
        } else {
          for (const target of targets) {
            await this.executionController.handleCommand("gauge.execute", target, testUiRunFlags());
          }
        }
      }
    } finally {
      if (run && typeof run.end === "function") {
        run.end();
      }
      if (this.currentRun === run) {
        this.currentRun = undefined;
      }
    }
  }

  ensureRun() {
    if (!this.currentRun) {
      this.startTestRun({});
    }
    return this.currentRun;
  }

  ensureItem(event) {
    const id = event && event.id;
    if (!id || !this.controller) {
      return undefined;
    }
    let item = this.items.get(id);
    if (!item) {
      const uri = itemUri(this.vscode, event.location);
      item = this.upsertItem(
        id,
        event.name || id,
        uri,
        undefined,
        event.parentId && event.parentId !== ROOT_PARENT_ID ? event.parentId : undefined,
      );
    } else if (event.name) {
      item.label = event.name;
    }
    return applyLocation(this.vscode, item, event.location);
  }

  finishItem(event) {
    const run = this.ensureRun();
    const item = this.ensureItem(event);
    if (!run || !item) {
      return;
    }
    const pending = this.pendingResults.get(event.id);
    this.pendingResults.delete(event.id);
    if (pending && pending.status === "failed" && typeof run.failed === "function") {
      run.failed(item, createMessage(this.vscode, pending.message), event.duration);
      return;
    }
    if (pending && pending.status === "skipped" && typeof run.skipped === "function") {
      run.skipped(item);
      return;
    }
    if (typeof run.passed === "function") {
      run.passed(item, event.duration);
    }
  }

  showNotification(event) {
    const text = notificationText(event);
    const window = this.vscode.window || {};
    const method = notificationMethod(event && event.severity);
    if (text && typeof window[method] === "function") {
      window[method](text);
    }
  }

  handleExecutionEvent(event) {
    if (!event || !event.type) {
      return;
    }
    const run = this.ensureRun();
    switch (event.type) {
      case "suiteStarted":
      case "testStarted": {
        const item = this.ensureItem(event);
        if (run && item && typeof run.started === "function") {
          run.started(item);
        }
        break;
      }
      case "suiteFinished":
      case "testFinished":
        this.finishItem(event);
        break;
      case "testFailed":
        this.pendingResults.set(event.id, {
          message: event.message,
          status: "failed",
        });
        break;
      case "testIgnored":
        this.pendingResults.set(event.id, {
          status: "skipped",
        });
        break;
      case "output":
        if (run && typeof run.appendOutput === "function") {
          run.appendOutput(event.message || "");
        }
        break;
      case "lineBreak":
        if (run && typeof run.appendOutput === "function") {
          run.appendOutput("\n");
        }
        break;
      case "notification":
        this.showNotification(event);
        break;
      default:
        break;
    }
  }
}

module.exports = {
  GaugeTestController,
};
