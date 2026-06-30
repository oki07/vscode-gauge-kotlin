"use strict";

const { headingMarkers } = require("./codeLensProvider");

const CONTROLLER_ID = "gauge";
const CONTROLLER_LABEL = "Gauge";
const GAUGE_LANGUAGE = "gauge";
const MARKDOWN_LANGUAGE = "markdown";
const MARKDOWN_SPEC_FILE_PATTERN = /\.md$/i;
const DEBUG_PROFILE_LABEL = "Debug";
const FAILED_PROFILE_LABEL = "Run Failed";
const RUN_PROFILE_LABEL = "Run";
const ROOT_PARENT_ID = "suite";
const SCENARIOS_REQUEST = "gauge/scenarios";
const SPECS_REQUEST = "gauge/specs";
const SPEC_WATCH_PATTERN = "**/*.{spec,md}";
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

function createToken(vscode) {
  if (typeof vscode.CancellationTokenSource === "function") {
    return new vscode.CancellationTokenSource().token;
  }
  return undefined;
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

function isMarkdownGaugeSpecificationDocument(document) {
  return Boolean(
    document
    && document.languageId === MARKDOWN_LANGUAGE
    && MARKDOWN_SPEC_FILE_PATTERN.test(documentPath(document))
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

function createOptionalMessage(vscode, message) {
  return message ? createMessage(vscode, message) : undefined;
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

function collectionValues(collection) {
  return collection && typeof collection.values === "function" ? collection.values() : [];
}

function excludedItemIds(request) {
  const excludedItems = Array.isArray(request && request.exclude) ? request.exclude : [];
  return new Set(excludedItems.map(executionTargetForItem).filter(Boolean));
}

function isExcludedItemId(itemId, excludedIds) {
  for (const excludedId of excludedIds) {
    if (itemId === excludedId || itemId.startsWith(`${excludedId}:`)) {
      return true;
    }
  }
  return false;
}

function hasExcludedDescendant(item, excludedIds) {
  const itemId = executionTargetForItem(item);
  if (!itemId) {
    return false;
  }
  for (const excludedId of excludedIds) {
    if (excludedId.startsWith(`${itemId}:`)) {
      return true;
    }
  }
  return false;
}

function expandExecutionItems(item, excludedIds) {
  const itemId = executionTargetForItem(item);
  if (!itemId || isExcludedItemId(itemId, excludedIds)) {
    return [];
  }
  const children = collectionValues(item.children);
  if (children.length > 0 && hasExcludedDescendant(item, excludedIds)) {
    return children.flatMap((child) => expandExecutionItems(child, excludedIds));
  }
  return [item];
}

function uniqueTargets(targets) {
  const seen = new Set();
  return targets.filter((target) => {
    if (seen.has(target)) {
      return false;
    }
    seen.add(target);
    return true;
  });
}

function executionTargetsForRequest(controller, request = {}) {
  const includedItems = Array.isArray(request.include) ? request.include : [];
  const excludedIds = excludedItemIds(request);
  if (includedItems.length === 0 && excludedIds.size === 0) {
    return undefined;
  }
  const candidateItems = includedItems.length > 0
    ? includedItems
    : collectionValues(controller && controller.items);
  return uniqueTargets(
    candidateItems
      .flatMap((item) => expandExecutionItems(item, excludedIds))
      .map(executionTargetForItem)
      .filter(Boolean),
  );
}

function isScenarioTarget(target) {
  return /:\d+$/.test(String(target || ""));
}

function canBatchSpecificationTargets(targets) {
  return targets.length > 1 && targets.every((target) => !isScenarioTarget(target));
}

function specFileFromExecutionIdentifier(executionIdentifier, lineNo) {
  const value = String(executionIdentifier || "");
  const suffix = `:${lineNo}`;
  if (value.endsWith(suffix)) {
    return value.slice(0, -suffix.length);
  }
  return value.replace(/:\d+$/, "");
}

function lineNoToZeroBased(lineNo) {
  const value = Number.parseInt(lineNo, 10);
  return Number.isFinite(value) ? Math.max(0, value - 1) : 0;
}

function testUiRunFlags() {
  return { ...TEST_UI_RUN_FLAGS };
}

function testUiDebugFlags() {
  return { ...TEST_UI_RUN_FLAGS, debug: true };
}

function knownProjectRoots(clientsMap) {
  if (!clientsMap || typeof clientsMap.keys !== "function") {
    return [];
  }
  return [...clientsMap.keys()].filter(Boolean);
}

class GaugeTestController {
  constructor(options = {}) {
    this.vscode = getVscode(options.vscode);
    this.clientsMap = options.clientsMap;
    this.executionController = options.executionController;
    this.projectChanges = options.projectChanges;
    this.projectFactory = options.projectFactory;
    this.controller = undefined;
    this.currentRun = undefined;
    this.items = new Map();
    this.pendingResults = new Map();
    this.childResults = new Map();
    this.workspaceDiscoveredIdsByClient = new Map();
  }

  register() {
    if (!this.vscode.tests || typeof this.vscode.tests.createTestController !== "function") {
      return undefined;
    }
    this.controller = this.vscode.tests.createTestController(CONTROLLER_ID, CONTROLLER_LABEL);
    this.registerRunProfiles();
    const disposables = this.registerDocumentDiscovery();
    addDisposable(disposables, this.registerProjectChangeListener(this.projectChanges));
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

  registerRunProfiles() {
    if (typeof this.controller.createRunProfile !== "function") {
      return;
    }
    const profileKind = this.vscode.TestRunProfileKind || {};
    this.controller.createRunProfile(
      RUN_PROFILE_LABEL,
      profileKind.Run,
      (request, token) => this.run(request, token),
      true,
    );
    this.controller.createRunProfile(
      DEBUG_PROFILE_LABEL,
      profileKind.Debug,
      (request, token) => this.debug(request, token),
      false,
    );
    this.controller.createRunProfile(
      FAILED_PROFILE_LABEL,
      profileKind.Run,
      (request, token) => this.runFailed(request, token),
      false,
    );
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
        this.removeDocumentItems(document, this.workspaceDiscoveredIdsForPath(documentPath(document)));
      }));
    }
    if (typeof workspace.createFileSystemWatcher === "function") {
      const watcher = workspace.createFileSystemWatcher(SPEC_WATCH_PATTERN, false, true, false);
      addDisposable(disposables, watcher);
      if (watcher && typeof watcher.onDidCreate === "function") {
        addDisposable(disposables, watcher.onDidCreate(() => this.refreshWorkspaceTests()));
      }
      if (watcher && typeof watcher.onDidDelete === "function") {
        addDisposable(disposables, watcher.onDidDelete((uri) => {
          this.removePathItems(uri && (uri.fsPath || uri.path));
          return this.refreshWorkspaceTests();
        }));
      }
    }
    return disposables;
  }

  registerProjectChangeListener(projectChanges) {
    if (!projectChanges || typeof projectChanges.onDidChangeProjects !== "function") {
      return undefined;
    }
    return projectChanges.onDidChangeProjects(() => this.refreshWorkspaceTests());
  }

  pruneRemovedClientWorkspaceTests() {
    if (!this.clientsMap || typeof this.clientsMap.values !== "function") {
      return;
    }
    const activeClients = new Set(
      [...this.clientsMap.values()]
        .map((entry) => entry && entry.client)
        .filter(Boolean),
    );
    for (const [client, ids] of [...this.workspaceDiscoveredIdsByClient]) {
      if (activeClients.has(client)) {
        continue;
      }
      for (const id of ids) {
        this.removeItem(id);
      }
      this.workspaceDiscoveredIdsByClient.delete(client);
    }
  }

  refreshWorkspaceTests() {
    this.pruneRemovedClientWorkspaceTests();
    return Promise.resolve(this.discoverWorkspaceTests()).catch(() => []);
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
    this.removePathItems(filename, keepIds);
  }

  removePathItems(filename, keepIds = new Set()) {
    if (!filename) {
      return;
    }
    for (const [id] of [...this.items]) {
      if ((id === filename || id.startsWith(`${filename}:`)) && !keepIds.has(id)) {
        this.removeItem(id);
      }
    }
  }

  workspaceDiscoveredIdsForPath(filename) {
    const keepIds = new Set();
    if (!filename) {
      return keepIds;
    }
    for (const ids of this.workspaceDiscoveredIdsByClient.values()) {
      for (const id of ids) {
        if (id === filename || id.startsWith(`${filename}:`)) {
          keepIds.add(id);
        }
      }
    }
    return keepIds;
  }

  removeItem(id) {
    collectionDelete(this.controller && this.controller.items, id);
    for (const item of this.items.values()) {
      collectionDelete(item && item.children, id);
    }
    this.items.delete(id);
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

  isGaugeProjectDocument(document) {
    if (!this.projectFactory) {
      return true;
    }
    const file = documentPath(document);
    if (!file || typeof this.projectFactory.getGaugeRootFromFilePath !== "function") {
      return true;
    }
    try {
      const root = this.projectFactory.getGaugeRootFromFilePath(file);
      if (!root) {
        return false;
      }
      if (typeof this.projectFactory.isGaugeProject === "function") {
        return this.projectFactory.isGaugeProject(root) !== false;
      }
      return true;
    } catch (_error) {
      return false;
    }
  }

  discoverDocument(document) {
    const markdownSpec = isMarkdownGaugeSpecificationDocument(document);
    if (!this.controller || (!isGaugeSpecificationDocument(document) && !markdownSpec)) {
      return [];
    }
    if (
      markdownSpec
      && (
        !this.projectFactory
        || typeof this.projectFactory.getGaugeRootFromFilePath !== "function"
      )
    ) {
      return [];
    }
    if (!this.isGaugeProjectDocument(document)) {
      this.removeDocumentItems(document, this.workspaceDiscoveredIdsForPath(documentPath(document)));
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

  setClientsMap(clientsMap) {
    this.clientsMap = clientsMap;
  }

  async discoverWorkspaceTests() {
    if (!this.controller || !this.clientsMap || typeof this.clientsMap.values !== "function") {
      return [];
    }
    const discovered = [];
    for (const entry of this.clientsMap.values()) {
      const client = entry && entry.client;
      if (!client || typeof client.sendRequest !== "function") {
        continue;
      }
      discovered.push(...await this.discoverClientTests(client));
    }
    return discovered;
  }

  async discoverClientTests(client) {
    let specs;
    try {
      specs = await client.sendRequest(SPECS_REQUEST, {}, createToken(this.vscode));
    } catch (_error) {
      return [];
    }
    const discovered = [];
    const discoveredIds = new Set();
    for (const spec of specs || []) {
      if (!spec || !spec.heading || !spec.executionIdentifier) {
        continue;
      }
      const specId = spec.executionIdentifier;
      discoveredIds.add(specId);
      const specItem = this.upsertItem(
        specId,
        spec.heading,
        fileUri(this.vscode, specId),
        undefined,
        undefined,
      );
      if (specItem) {
        discovered.push(specItem);
      }

      let scenarios;
      try {
        scenarios = await client.sendRequest(
          SCENARIOS_REQUEST,
          {
            textDocument: { uri: specId },
            position: createPosition(this.vscode, 1, 1),
          },
          createToken(this.vscode),
        );
      } catch (_error) {
        scenarios = [];
      }
      for (const scenario of scenarios || []) {
        if (!scenario || !scenario.heading || !scenario.executionIdentifier) {
          continue;
        }
        discoveredIds.add(scenario.executionIdentifier);
        const scenarioFile = specFileFromExecutionIdentifier(
          scenario.executionIdentifier,
          scenario.lineNo,
        ) || specId;
        const scenarioItem = this.upsertItem(
          scenario.executionIdentifier,
          scenario.heading,
          fileUri(this.vscode, scenarioFile),
          createRange(this.vscode, lineNoToZeroBased(scenario.lineNo)),
          specId,
        );
        if (scenarioItem) {
          discovered.push(scenarioItem);
        }
      }
    }
    this.pruneWorkspaceDiscoveredItems(client, discoveredIds);
    this.workspaceDiscoveredIdsByClient.set(client, discoveredIds);
    return discovered;
  }

  pruneWorkspaceDiscoveredItems(client, discoveredIds) {
    const previousIds = this.workspaceDiscoveredIdsByClient.get(client);
    if (!previousIds) {
      return;
    }
    for (const id of previousIds) {
      if (!discoveredIds.has(id)) {
        this.removeItem(id);
      }
    }
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
    this.childResults.clear();
    return this.currentRun;
  }

  stopExecution() {
    if (!this.executionController || typeof this.executionController.handleCommand !== "function") {
      return;
    }
    Promise.resolve(this.executionController.handleCommand("gauge.stopExecution")).catch(() => {});
  }

  registerCancellation(token) {
    if (!token || typeof token.onCancellationRequested !== "function") {
      return undefined;
    }
    const disposable = token.onCancellationRequested(() => this.stopExecution());
    if (token.isCancellationRequested) {
      this.stopExecution();
    }
    return disposable;
  }

  async runWithFlags(request = {}, flags = testUiRunFlags(), token) {
    const run = this.startTestRun(request);
    const cancellation = this.registerCancellation(token);
    try {
      if (this.executionController && typeof this.executionController.handleCommand === "function") {
        const targets = executionTargetsForRequest(this.controller, request);
        if (targets === undefined) {
          const projectRoots = knownProjectRoots(this.clientsMap);
          if (projectRoots.length > 0) {
            for (const projectRoot of projectRoots) {
              await this.executionController.handleCommand(
                "gauge.specexplorer.runAllActiveProjectSpecs",
                { projectRoot },
                flags,
              );
            }
          } else {
            await this.executionController.handleCommand(
              "gauge.execute.specification.all",
              undefined,
              flags,
            );
          }
        } else if (canBatchSpecificationTargets(targets)) {
          await this.executionController.handleCommand(
            "gauge.execute.specification",
            undefined,
            targets,
            flags,
          );
        } else {
          for (const target of targets) {
            await this.executionController.handleCommand("gauge.execute", target, flags);
          }
        }
      }
    } finally {
      if (cancellation && typeof cancellation.dispose === "function") {
        cancellation.dispose();
      }
      if (run && typeof run.end === "function") {
        run.end();
      }
      if (this.currentRun === run) {
        this.currentRun = undefined;
      }
    }
  }

  async run(request = {}, token) {
    return this.runWithFlags(request, testUiRunFlags(), token);
  }

  async debug(request = {}, token) {
    return this.runWithFlags(request, testUiDebugFlags(), token);
  }

  async runFailed(request = {}, token) {
    const run = this.startTestRun(request);
    const cancellation = this.registerCancellation(token);
    try {
      if (this.executionController && typeof this.executionController.handleCommand === "function") {
        await this.executionController.handleCommand(
          "gauge.execute.failed",
          undefined,
          testUiRunFlags(),
        );
      }
    } finally {
      if (cancellation && typeof cancellation.dispose === "function") {
        cancellation.dispose();
      }
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

  recordChildResult(event, status, message) {
    const parentId = event && event.parentId;
    if (!parentId || parentId === ROOT_PARENT_ID) {
      return;
    }
    const result = this.childResults.get(parentId) || {
      failed: false,
      message: undefined,
      passed: false,
      skipped: false,
    };
    if (status === "failed") {
      result.failed = true;
      if (message && !result.message) {
        result.message = message;
      }
    } else if (status === "skipped") {
      result.skipped = true;
      if (message && !result.message) {
        result.message = message;
      }
    } else {
      result.passed = true;
    }
    this.childResults.set(parentId, result);
  }

  finishItem(event) {
    const run = this.ensureRun();
    const item = this.ensureItem(event);
    if (!run || !item) {
      return;
    }
    const childResult = event.type === "suiteFinished"
      ? this.childResults.get(event.id)
      : undefined;
    if (childResult) {
      this.childResults.delete(event.id);
      if (childResult.failed && typeof run.failed === "function") {
        run.failed(item, createMessage(this.vscode, childResult.message || ""), event.duration);
        return;
      }
      if (childResult.skipped && !childResult.passed && typeof run.skipped === "function") {
        run.skipped(item, createOptionalMessage(this.vscode, childResult.message));
        return;
      }
    }
    const pending = this.pendingResults.get(event.id);
    this.pendingResults.delete(event.id);
    if (pending && pending.status === "failed" && typeof run.failed === "function") {
      this.recordChildResult(event, "failed", pending.message);
      run.failed(item, createMessage(this.vscode, pending.message), event.duration);
      return;
    }
    if (pending && pending.status === "skipped" && typeof run.skipped === "function") {
      this.recordChildResult(event, "skipped", pending.message);
      run.skipped(item, createOptionalMessage(this.vscode, pending.message));
      return;
    }
    this.recordChildResult(event, "passed");
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
          message: event.message,
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
