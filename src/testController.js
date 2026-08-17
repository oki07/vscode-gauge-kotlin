"use strict";

const nodePath = require("node:path");
const { concurrencyLimit, mapWithConcurrency } = require("./asyncWork");
const { headingMarkers } = require("./gaugeHeadings");

const CONTROLLER_ID = "gauge";
const CONTROLLER_LABEL = "Gauge";
const UNEXPLAINED_SKIP_MESSAGE = "Gauge skipped this scenario without reporting a reason.";
const GAUGE_LANGUAGE = "gauge";
const MARKDOWN_LANGUAGE = "markdown";
const MARKDOWN_SPEC_FILE_PATTERN = /\.md$/i;
const SPEC_FILE_PATTERN = /\.spec$/i;
const DEBUG_PROFILE_LABEL = "Debug";
const FAILED_PROFILE_LABEL = "Run Failed";
const REPEAT_PROFILE_LABEL = "Run Repeat";
const RUN_PROFILE_LABEL = "Run";
const RUNNABLE_TAG_ID = "gauge-runnable";
const ROOT_PARENT_ID = "suite";
const SCENARIOS_REQUEST = "gauge/scenarios";
const SPECS_REQUEST = "gauge/specs";
const SPEC_WATCH_PATTERN = "**/*.{spec,md}";
const ATTEMPT_ID_SEPARATOR = "#attempt=";
const TEST_UI_RUN_FLAGS = {
  "hide-suggestion": true,
  "simple-console": false,
  testUi: true,
};
const NON_GAUGE_PROJECT_ROOT = Symbol("nonGaugeProjectRoot");
const DEFAULT_SCENARIO_REQUEST_CONCURRENCY = 8;

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

function cancellationRequested(token) {
  return Boolean(token && token.isCancellationRequested);
}

function documentPath(document) {
  const uri = document && document.uri;
  return (uri && (uri.fsPath || uri.path)) || (document && document.fileName) || "";
}

function isConceptDocument(document) {
  return documentPath(document).toLowerCase().endsWith(".cpt");
}

function isGaugeSpecificationDocument(document) {
  const file = documentPath(document);
  return Boolean(
    document
    && (document.languageId === GAUGE_LANGUAGE || SPEC_FILE_PATTERN.test(file))
    && !isConceptDocument(document)
    && file,
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

function createMessageLocation(vscode, location) {
  const parsed = parseGaugeLocation(location);
  const uri = parsed && itemUri(vscode, location);
  if (!parsed || !uri) {
    return undefined;
  }
  const range = createRange(vscode, parsed.line);
  return typeof vscode.Location === "function"
    ? new vscode.Location(uri, range)
    : { uri, range };
}

function createMessage(vscode, message, location) {
  if (typeof vscode.TestMessage === "function") {
    const testMessage = new vscode.TestMessage(message || "");
    const resolvedLocation = createMessageLocation(vscode, location);
    if (resolvedLocation) {
      testMessage.location = resolvedLocation;
    }
    return testMessage;
  }
  return message || "";
}

function createOptionalMessage(vscode, message) {
  return message ? createMessage(vscode, message) : undefined;
}

function testResultsOutput(value) {
  return String(value || "").replace(/\r?\n/g, "\r\n");
}

function appendTestResultsOutput(run, value) {
  if (run && typeof run.appendOutput === "function") {
    run.appendOutput(testResultsOutput(value));
  }
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

// TestItemCollection exposes forEach and iteration over [id, item] pairs; it
// has no values(). Reading a missing method silently emptied every traversal.
function collectionValues(collection) {
  if (!collection) {
    return [];
  }
  if (typeof collection.forEach === "function") {
    const items = [];
    collection.forEach((item) => {
      items.push(item);
    });
    return items;
  }
  if (typeof collection[Symbol.iterator] === "function") {
    return [...collection].map((entry) => (Array.isArray(entry) ? entry[1] : entry));
  }
  return [];
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

function testRunRequest(vscode, item) {
  const include = item ? [item] : [];
  return typeof vscode.TestRunRequest === "function"
    ? new vscode.TestRunRequest(include, undefined, undefined, undefined, false)
    : { include, preserveFocus: false };
}

function attemptItemId(id, attempt) {
  return attempt > 1 ? `${id}${ATTEMPT_ID_SEPARATOR}${attempt}` : id;
}

function attemptNumberFromItemId(id) {
  const match = new RegExp(`${ATTEMPT_ID_SEPARATOR}(\\d+)$`).exec(String(id || ""));
  if (!match) {
    return 1;
  }
  const attempt = Number.parseInt(match[1], 10);
  return Number.isFinite(attempt) ? attempt : 1;
}

function attemptItemName(name, id, attempt) {
  if (attempt <= 1) {
    return name;
  }
  return `${name || id} (attempt ${attempt})`;
}

function knownProjectRoots(clientsMap) {
  if (!clientsMap || typeof clientsMap.keys !== "function") {
    return [];
  }
  return [...clientsMap.keys()].filter(Boolean);
}

function targetFile(target) {
  return String(target || "").replace(/:\d+$/, "");
}

function isInsideProjectRoot(projectRoot, target) {
  const relative = nodePath.relative(projectRoot, targetFile(target));
  return relative === "" || (!relative.startsWith("..") && !nodePath.isAbsolute(relative));
}

function projectRootFromFactory(projectFactory, target) {
  if (!projectFactory || typeof projectFactory.getGaugeRootFromFilePath !== "function") {
    return undefined;
  }
  try {
    const projectRoot = projectFactory.getGaugeRootFromFilePath(targetFile(target));
    if (!projectRoot) {
      return NON_GAUGE_PROJECT_ROOT;
    }
    if (
      typeof projectFactory.isGaugeProject === "function"
      && projectFactory.isGaugeProject(projectRoot) === false
    ) {
      return NON_GAUGE_PROJECT_ROOT;
    }
    return projectRoot;
  } catch (_) {
    return NON_GAUGE_PROJECT_ROOT;
  }
}

function projectRootForTarget(target, projectRoots, projectFactory) {
  return projectRoots
    .filter((projectRoot) => isInsideProjectRoot(projectRoot, target))
    .sort((left, right) => right.length - left.length)[0]
    || projectRootFromFactory(projectFactory, target);
}

function groupedTargetsByKnownProject(targets, clientsMap, projectFactory) {
  const projectRoots = knownProjectRoots(clientsMap);
  const groups = [];
  const groupIndexes = new Map();
  for (const target of targets) {
    const resolvedProjectRoot = projectRootForTarget(target, projectRoots, projectFactory);
    if (resolvedProjectRoot === NON_GAUGE_PROJECT_ROOT) {
      continue;
    }
    const projectRoot = resolvedProjectRoot || "";
    let groupIndex = groupIndexes.get(projectRoot);
    if (groupIndex === undefined) {
      groupIndex = groups.length;
      groupIndexes.set(projectRoot, groupIndex);
      groups.push({ projectRoot, targets: [] });
    }
    groups[groupIndex].targets.push(target);
  }
  return groups;
}

function projectRootsForGroups(groups) {
  const seen = new Set();
  return groups
    .map((group) => group.projectRoot)
    .filter((projectRoot) => {
      if (!projectRoot || seen.has(projectRoot)) {
        return false;
      }
      seen.add(projectRoot);
      return true;
    });
}

class GaugeTestController {
  constructor(options = {}) {
    this.vscode = getVscode(options.vscode);
    this.clientsMap = options.clientsMap;
    this.executionController = options.executionController;
    this.projectChanges = options.projectChanges;
    this.projectFactory = options.projectFactory;
    this.scenarioRequestConcurrency = concurrencyLimit(
      options.scenarioRequestConcurrency,
      DEFAULT_SCENARIO_REQUEST_CONCURRENCY,
    );
    this.controller = undefined;
    this.activeRunContext = undefined;
    this.currentRun = undefined;
    this.currentRequest = undefined;
    this.testOutputShown = false;
    this.items = new Map();
    this.pendingResults = new Map();
    this.resultOnlyItemIds = new Set();
    this.runnableTag = typeof this.vscode.TestTag === "function"
      ? new this.vscode.TestTag(RUNNABLE_TAG_ID)
      : undefined;
    this.attemptCounts = new Map();
    this.activeAttemptIds = new Map();
    this.workspaceDiscoveredIdsByClient = new Map();
  }

  register() {
    if (!this.vscode.tests || typeof this.vscode.tests.createTestController !== "function") {
      return undefined;
    }
    this.controller = this.vscode.tests.createTestController(CONTROLLER_ID, CONTROLLER_LABEL);
    this.controller.resolveHandler = (item) => (
      item ? undefined : this.refreshWorkspaceTests()
    );
    this.controller.refreshHandler = () => this.refreshWorkspaceTests();
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
      this.runnableTag,
    );
    this.controller.createRunProfile(
      DEBUG_PROFILE_LABEL,
      profileKind.Debug,
      (request, token) => this.debug(request, token),
      false,
      this.runnableTag,
    );
    this.controller.createRunProfile(
      FAILED_PROFILE_LABEL,
      profileKind.Run,
      (request, token) => this.runFailed(request, token),
      false,
      this.runnableTag,
    );
    this.controller.createRunProfile(
      REPEAT_PROFILE_LABEL,
      profileKind.Run,
      (request, token) => this.runRepeat(request, token),
      false,
      this.runnableTag,
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
    this.resultOnlyItemIds.delete(id);
  }

  cleanupResultOnlyItems() {
    for (const id of [...this.resultOnlyItemIds]) {
      this.removeItem(id);
    }
  }

  setItemRunnable(item, runnable) {
    if (!item || !this.runnableTag) {
      return;
    }
    const tags = Array.isArray(item.tags) ? item.tags : [];
    const withoutRunnable = tags.filter((tag) => tag && tag.id !== this.runnableTag.id);
    item.tags = runnable ? [...withoutRunnable, this.runnableTag] : withoutRunnable;
  }

  upsertItem(id, label, uri, range, parentId, runnable = true) {
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
    this.setItemRunnable(item, runnable);

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
    const specEntries = (specs || []).filter((spec) => (
      spec && spec.heading && spec.executionIdentifier
    ));
    const scenarioLists = await mapWithConcurrency(
      specEntries,
      this.scenarioRequestConcurrency,
      (spec) => {
        let request;
        try {
          request = client.sendRequest(
            SCENARIOS_REQUEST,
            {
              textDocument: { uri: spec.executionIdentifier },
              position: createPosition(this.vscode, 1, 1),
            },
            createToken(this.vscode),
          );
        } catch (_error) {
          return [];
        }
        return Promise.resolve(request).catch(() => []);
      },
    );
    for (const [specIndex, spec] of specEntries.entries()) {
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

      const scenarios = scenarioLists[specIndex];
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

  createRunContext(request) {
    const context = {
      cancelled: false,
      ended: false,
      request,
      run: undefined,
    };
    context.metadata = {
      onCancelled: () => {
        context.cancelled = true;
      },
      onStart: () => {
        this.activateRunContext(context);
      },
      onSuperseded: () => {
        context.cancelled = true;
      },
    };
    return context;
  }

  activateRunContext(context) {
    if (!context || context.ended || this.activeRunContext === context) {
      return;
    }
    if (this.activeRunContext) {
      this.finishRunContext(this.activeRunContext);
    }
    this.activeRunContext = context;
    this.prepareTestRun(context.request);
    this.currentRun = context.run;
  }

  finishRunContext(context) {
    if (!context || context.ended) {
      return;
    }
    context.ended = true;
    if (context.run && typeof context.run.end === "function") {
      context.run.end();
    }
    if (this.activeRunContext === context) {
      this.cleanupResultOnlyItems();
      this.activeRunContext = undefined;
      this.currentRun = undefined;
      this.currentRequest = undefined;
    }
  }

  handleExecutionCommand(context, command, ...args) {
    if (!this.executionController) {
      return undefined;
    }
    if (typeof this.executionController.handleCommandWithMetadata === "function") {
      return this.executionController.handleCommandWithMetadata(
        command,
        context.metadata,
        ...args,
      );
    }
    this.activateRunContext(context);
    return this.executionController.handleCommand(command, ...args);
  }

  runContextCancelled(context, token) {
    return context.cancelled || cancellationRequested(token);
  }

  testItemForTarget(target) {
    const existing = this.items.get(target);
    if (existing) {
      return existing;
    }
    const file = targetFile(target);
    const uri = fileUri(this.vscode, file);
    const scenarioMatch = /:(\d+)$/.exec(String(target || ""));
    if (!scenarioMatch) {
      return this.upsertItem(file, nodePath.basename(file), uri);
    }
    const parent = this.items.get(file)
      || this.upsertItem(file, nodePath.basename(file), uri);
    const line = Math.max(0, Number.parseInt(scenarioMatch[1], 10) - 1);
    return this.upsertItem(
      target,
      target,
      uri,
      createRange(this.vscode, line),
      parent && parent.id,
    );
  }

  runCodeLensTarget(command, target, token) {
    const item = this.testItemForTarget(target);
    const request = testRunRequest(this.vscode, item);
    const flags = command === "gauge.debug"
      ? testUiDebugFlags()
      : testUiRunFlags();
    if (command === "gauge.execute.inParallel") {
      flags.parallel = true;
    }
    return this.runWithFlags(request, flags, token);
  }

  createExecutionEventSink() {
    return (event) => this.handleExecutionEvent(event);
  }

  prepareTestRun(request = {}) {
    this.cleanupResultOnlyItems();
    this.currentRequest = request;
    this.pendingResults.clear();
    this.attemptCounts.clear();
    this.activeAttemptIds.clear();
    this.testOutputShown = false;
  }

  startTestRun(request = {}) {
    this.prepareTestRun(request);
    if (!this.controller || typeof this.controller.createTestRun !== "function") {
      return undefined;
    }
    this.currentRun = this.controller.createTestRun(request);
    return this.currentRun;
  }

  showTestOutput() {
    if (this.testOutputShown) {
      return;
    }
    const commands = this.vscode.commands;
    if (!commands || typeof commands.executeCommand !== "function") {
      return;
    }
    this.testOutputShown = true;
    try {
      const opening = commands.executeCommand("testing.showMostRecentOutput");
      if (opening && typeof opening.catch === "function") {
        opening.catch(() => {});
      }
    } catch (_error) {
      // Test execution remains available when the output view cannot be opened.
    }
  }

  stopExecution() {
    if (!this.executionController || typeof this.executionController.handleCommand !== "function") {
      return;
    }
    Promise.resolve(this.executionController.handleCommand("gauge.stopExecution")).catch(() => {});
  }

  registerCancellation(token, context) {
    if (!token || typeof token.onCancellationRequested !== "function") {
      return undefined;
    }
    const cancel = () => {
      if (context) {
        context.cancelled = true;
      }
      this.stopExecution();
    };
    const disposable = token.onCancellationRequested(cancel);
    if (token.isCancellationRequested) {
      cancel();
    }
    return disposable;
  }

  async runWithFlags(request = {}, flags = testUiRunFlags(), token) {
    const context = this.createRunContext(request);
    const cancellation = this.registerCancellation(token, context);
    try {
      if (
        this.executionController
        && (
          typeof this.executionController.handleCommand === "function"
          || typeof this.executionController.handleCommandWithMetadata === "function"
        )
        && !this.runContextCancelled(context, token)
      ) {
        const targets = executionTargetsForRequest(this.controller, request);
        if (targets === undefined) {
          const projectRoots = knownProjectRoots(this.clientsMap);
          if (projectRoots.length > 0) {
            for (const projectRoot of projectRoots) {
              if (this.runContextCancelled(context, token)) {
                break;
              }
              await this.handleExecutionCommand(
                context,
                "gauge.specexplorer.runAllActiveProjectSpecs",
                { projectRoot },
                flags,
              );
            }
          } else {
            await this.handleExecutionCommand(
              context,
              "gauge.execute.specification.all",
              undefined,
              flags,
            );
          }
        } else {
          const targetGroups = groupedTargetsByKnownProject(targets, this.clientsMap, this.projectFactory);
          const runnableTargets = targetGroups.flatMap((group) => group.targets);
          if (runnableTargets.length === 0) {
            return;
          }
          if (canBatchSpecificationTargets(runnableTargets)) {
            for (const group of targetGroups) {
              if (this.runContextCancelled(context, token)) {
                break;
              }
              await this.handleExecutionCommand(
                context,
                "gauge.execute.specification",
                undefined,
                group.targets,
                flags,
              );
            }
          } else {
            for (const target of runnableTargets) {
              if (this.runContextCancelled(context, token)) {
                break;
              }
              await this.handleExecutionCommand(
                context,
                "gauge.execute",
                target,
                flags,
              );
            }
          }
        }
      }
    } finally {
      if (cancellation && typeof cancellation.dispose === "function") {
        cancellation.dispose();
      }
      this.finishRunContext(context);
    }
  }

  async run(request = {}, token) {
    return this.runWithFlags(request, testUiRunFlags(), token);
  }

  async debug(request = {}, token) {
    return this.runWithFlags(request, testUiDebugFlags(), token);
  }

  async runProjectScopedCommand(command, request = {}, token) {
    const context = this.createRunContext(request);
    const cancellation = this.registerCancellation(token, context);
    try {
      if (
        this.executionController
        && (
          typeof this.executionController.handleCommand === "function"
          || typeof this.executionController.handleCommandWithMetadata === "function"
        )
        && !this.runContextCancelled(context, token)
      ) {
        const flags = testUiRunFlags();
        const targets = executionTargetsForRequest(this.controller, request);
        const targetGroups = targets === undefined
          ? undefined
          : groupedTargetsByKnownProject(targets, this.clientsMap, this.projectFactory);
        if (targetGroups && targetGroups.length === 0) {
          return;
        }
        const projectRoots = targetGroups === undefined
          ? []
          : projectRootsForGroups(targetGroups);
        if (projectRoots.length > 0) {
          for (const projectRoot of projectRoots) {
            if (this.runContextCancelled(context, token)) {
              break;
            }
            await this.handleExecutionCommand(
              context,
              command,
              { projectRoot },
              flags,
            );
          }
        } else {
          await this.handleExecutionCommand(
            context,
            command,
            undefined,
            flags,
          );
        }
      }
    } finally {
      if (cancellation && typeof cancellation.dispose === "function") {
        cancellation.dispose();
      }
      this.finishRunContext(context);
    }
  }

  async runFailed(request = {}, token) {
    return this.runProjectScopedCommand("gauge.execute.failed", request, token);
  }

  async runRepeat(request = {}, token) {
    return this.runProjectScopedCommand("gauge.execute.repeat", request, token);
  }

  ensureRun() {
    if (!this.currentRun) {
      const request = this.currentRequest || {};
      if (this.currentRequest === undefined) {
        this.prepareTestRun(request);
      }
      if (this.controller && typeof this.controller.createTestRun === "function") {
        this.currentRun = this.controller.createTestRun(request);
        if (this.activeRunContext) {
          this.activeRunContext.run = this.currentRun;
        }
      }
    }
    return this.currentRun;
  }

  resolveAttemptEvent(event) {
    if (!event || !event.id || !String(event.type || "").startsWith("test")) {
      return event;
    }
    const logicalId = event.id;
    if (event.type === "testStarted") {
      const attempt = (this.attemptCounts.get(logicalId) || 0) + 1;
      this.attemptCounts.set(logicalId, attempt);
      const id = attemptItemId(logicalId, attempt);
      this.activeAttemptIds.set(logicalId, id);
      return {
        ...event,
        id,
        logicalId,
        name: attemptItemName(event.name, logicalId, attempt),
        resultOnly: event.resultOnly || attempt > 1,
      };
    }
    const id = this.activeAttemptIds.get(logicalId) || logicalId;
    const attempt = attemptNumberFromItemId(id);
    return {
      ...event,
      id,
      logicalId,
      name: attemptItemName(event.name, logicalId, attempt),
      resultOnly: event.resultOnly || attempt > 1,
    };
  }

  ensureItem(event) {
    const id = event && event.id;
    if (!id || !this.controller) {
      return undefined;
    }
    let item = this.items.get(id);
    if (!item) {
      const uri = event.resultOnly ? undefined : itemUri(this.vscode, event.location);
      item = this.upsertItem(
        id,
        event.name || id,
        uri,
        undefined,
        this.parentIdForEvent(event),
        !event.resultOnly,
      );
    } else if (event.name) {
      item.label = event.name;
    }
    this.setItemRunnable(item, !event.resultOnly);
    if (event.resultOnly) {
      this.resultOnlyItemIds.add(id);
    }
    return event.resultOnly ? item : applyLocation(this.vscode, item, event.location);
  }

  parentIdForEvent(event) {
    const parentId = event.parentId && event.parentId !== ROOT_PARENT_ID
      ? event.parentId
      : undefined;
    const included = this.currentRequest && Array.isArray(this.currentRequest.include)
      ? this.currentRequest.include.filter((item) => item && item.id)
      : [];
    if (!event.resultOnly || included.length === 0) {
      return parentId;
    }
    if (parentId && included.some((item) => (
      item.id === parentId || parentId.startsWith(`${item.id}:`)
    ))) {
      return parentId;
    }
    if (parentId) {
      const descendant = included.find((item) => item.id.startsWith(`${parentId}:`));
      if (descendant) {
        return descendant.id;
      }
    }
    return included[0].id;
  }

  forgetActiveAttempt(event) {
    if (event && event.id) {
      this.activeAttemptIds.delete(event.id);
    }
  }

  appendItemOutput(run, item, message, location) {
    if (!run || typeof run.appendOutput !== "function" || !String(message || "").trim()) {
      return;
    }
    run.appendOutput(
      testResultsOutput(message),
      createMessageLocation(this.vscode, location),
      item,
    );
  }

  finishItem(event) {
    const run = this.ensureRun();
    const item = this.ensureItem(event);
    if (!run || !item) {
      return;
    }
    const pending = this.pendingResults.get(event.id);
    this.pendingResults.delete(event.id);
    if (pending && pending.status === "errored" && typeof run.errored === "function") {
      run.errored(
        item,
        createMessage(this.vscode, pending.message, pending.location),
        event.duration,
      );
      return "errored";
    }
    if (pending && pending.status === "failed" && typeof run.failed === "function") {
      run.failed(
        item,
        createMessage(this.vscode, pending.message, pending.location),
        event.duration,
      );
      return "failed";
    }
    if (pending && pending.status === "skipped" && typeof run.skipped === "function") {
      // TestRun.skipped carries no message, so Gauge's skip reason (which
      // names the file, line and unimplemented step) has to be attached to the
      // item through appendOutput or the user gets an unexplained grey result.
      // Every non-JSON Gauge reporter returns early for a skipped scenario, so
      // when Gauge states no reason there is nothing in the run output either.
      this.appendItemOutput(
        run,
        item,
        String(pending.message || "").trim() || UNEXPLAINED_SKIP_MESSAGE,
        pending.location,
      );
      run.skipped(item);
      return "skipped";
    }
    if (typeof run.passed === "function") {
      run.passed(item, event.duration);
    }
    return "passed";
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
      case "processStarted":
        this.showTestOutput();
        break;
      case "suiteStarted": {
        this.ensureItem(event);
        break;
      }
      case "testStarted": {
        const attemptEvent = this.resolveAttemptEvent(event);
        const item = this.ensureItem(attemptEvent);
        if (run && item && typeof run.started === "function") {
          run.started(item);
        }
        break;
      }
      case "suiteFinished":
        break;
      case "testFinished": {
        const attemptEvent = this.resolveAttemptEvent(event);
        this.finishItem(attemptEvent);
        this.forgetActiveAttempt(event);
        break;
      }
      case "testFailed": {
        const attemptEvent = this.resolveAttemptEvent(event);
        this.pendingResults.set(attemptEvent.id, {
          location: attemptEvent.location,
          message: attemptEvent.message,
          status: "failed",
        });
        break;
      }
      case "testErrored": {
        const attemptEvent = this.resolveAttemptEvent(event);
        this.pendingResults.set(attemptEvent.id, {
          location: attemptEvent.location,
          message: attemptEvent.message,
          status: "errored",
        });
        break;
      }
      case "testIgnored": {
        const attemptEvent = this.resolveAttemptEvent(event);
        this.pendingResults.set(attemptEvent.id, {
          location: attemptEvent.location,
          message: attemptEvent.message,
          status: "skipped",
        });
        break;
      }
      case "output":
        appendTestResultsOutput(run, event.message);
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
  DEFAULT_SCENARIO_REQUEST_CONCURRENCY,
  GaugeTestController,
};
