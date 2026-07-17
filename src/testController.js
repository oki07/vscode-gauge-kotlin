"use strict";

const nodePath = require("node:path");
const { concurrencyLimit, mapWithConcurrency } = require("./asyncWork");
const { headingMarkers } = require("./gaugeHeadings");

const CONTROLLER_ID = "gauge";
const CONTROLLER_LABEL = "Gauge";
const GAUGE_LANGUAGE = "gauge";
const MARKDOWN_LANGUAGE = "markdown";
const MARKDOWN_SPEC_FILE_PATTERN = /\.md$/i;
const SPEC_FILE_PATTERN = /\.spec$/i;
const DEBUG_PROFILE_LABEL = "Debug";
const FAILED_PROFILE_LABEL = "Run Failed";
const REPEAT_PROFILE_LABEL = "Run Repeat";
const RUN_PROFILE_LABEL = "Run";
const ROOT_PARENT_ID = "suite";
const SCENARIOS_REQUEST = "gauge/scenarios";
const SPECS_REQUEST = "gauge/specs";
const SPEC_WATCH_PATTERN = "**/*.{spec,md}";
const ATTEMPT_ID_SEPARATOR = "#attempt=";
const TEST_UI_RUN_FLAGS = {
  "hide-suggestion": true,
  "machine-readable": true,
};
const ANSI_CYAN = "\x1b[36m";
const ANSI_GREEN = "\x1b[32m";
const ANSI_RED = "\x1b[31m";
const ANSI_RESET = "\x1b[0m";
const ANSI_YELLOW = "\x1b[33m";
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

function createMessage(vscode, message) {
  if (typeof vscode.TestMessage === "function") {
    return new vscode.TestMessage(message || "");
  }
  return message || "";
}

function createOptionalMessage(vscode, message) {
  return message ? createMessage(vscode, message) : undefined;
}

function testResultsOutput(value) {
  return String(value || "").replace(/\r\n|\r|\n/g, "\r\n");
}

function appendTestResultsOutput(run, value) {
  if (run && typeof run.appendOutput === "function") {
    run.appendOutput(testResultsOutput(value));
  }
}

function highlightedHeading(event, prefix, color) {
  const name = String((event && (event.name || event.id)) || "");
  return name ? `${color}${prefix}${name}${ANSI_RESET}\r\n` : "";
}

function highlightedResult(status) {
  const styles = {
    failed: [ANSI_RED, "FAIL"],
    passed: [ANSI_GREEN, "PASS"],
    skipped: [ANSI_YELLOW, "SKIP"],
  };
  const style = styles[status];
  return style ? `    ${style[0]}[${style[1]}]${ANSI_RESET}\r\n` : "";
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

function summarizeChildResults(result) {
  if (!result || !(result.children instanceof Map) || result.children.size === 0) {
    return undefined;
  }
  const summary = {
    failed: false,
    message: undefined,
    passed: false,
    skipped: false,
  };
  for (const child of result.children.values()) {
    if (child.status === "failed") {
      summary.failed = true;
      if (child.message && !summary.message) {
        summary.message = child.message;
      }
    } else if (child.status === "skipped") {
      summary.skipped = true;
      if (child.message && !summary.message) {
        summary.message = child.message;
      }
    } else {
      summary.passed = true;
    }
  }
  return summary;
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
    this.currentRun = undefined;
    this.items = new Map();
    this.pendingResults = new Map();
    this.childResults = new Map();
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
    this.controller.createRunProfile(
      REPEAT_PROFILE_LABEL,
      profileKind.Run,
      (request, token) => this.runRepeat(request, token),
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

  startTestRun(request = {}) {
    if (!this.controller || typeof this.controller.createTestRun !== "function") {
      return undefined;
    }
    this.currentRun = this.controller.createTestRun(request);
    this.pendingResults.clear();
    this.childResults.clear();
    this.attemptCounts.clear();
    this.activeAttemptIds.clear();
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
      if (
        this.executionController
        && typeof this.executionController.handleCommand === "function"
        && !cancellationRequested(token)
      ) {
        const targets = executionTargetsForRequest(this.controller, request);
        if (targets === undefined) {
          const projectRoots = knownProjectRoots(this.clientsMap);
          if (projectRoots.length > 0) {
            for (const projectRoot of projectRoots) {
              if (cancellationRequested(token)) {
                break;
              }
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
        } else {
          const targetGroups = groupedTargetsByKnownProject(targets, this.clientsMap, this.projectFactory);
          const runnableTargets = targetGroups.flatMap((group) => group.targets);
          if (runnableTargets.length === 0) {
            return;
          }
          if (canBatchSpecificationTargets(runnableTargets)) {
            for (const group of targetGroups) {
              if (cancellationRequested(token)) {
                break;
              }
              await this.executionController.handleCommand(
                "gauge.execute.specification",
                undefined,
                group.targets,
                flags,
              );
            }
          } else {
            for (const target of runnableTargets) {
              if (cancellationRequested(token)) {
                break;
              }
              await this.executionController.handleCommand("gauge.execute", target, flags);
            }
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

  async runProjectScopedCommand(command, request = {}, token) {
    const run = this.startTestRun(request);
    const cancellation = this.registerCancellation(token);
    try {
      if (
        this.executionController
        && typeof this.executionController.handleCommand === "function"
        && !cancellationRequested(token)
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
            if (cancellationRequested(token)) {
              break;
            }
            await this.executionController.handleCommand(
              command,
              { projectRoot },
              flags,
            );
          }
        } else {
          await this.executionController.handleCommand(
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
      if (run && typeof run.end === "function") {
        run.end();
      }
      if (this.currentRun === run) {
        this.currentRun = undefined;
      }
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
      this.startTestRun({});
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
      };
    }
    const id = this.activeAttemptIds.get(logicalId) || logicalId;
    const attempt = attemptNumberFromItemId(id);
    return {
      ...event,
      id,
      logicalId,
      name: attemptItemName(event.name, logicalId, attempt),
    };
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
    const childId = event && (event.logicalId || event.id);
    if (!childId) {
      return;
    }
    const result = this.childResults.get(parentId) || {
      children: new Map(),
    };
    const child = {
      message,
      status,
    };
    result.children.set(childId, child);
    this.childResults.set(parentId, result);
  }

  forgetActiveAttempt(event) {
    if (event && event.id) {
      this.activeAttemptIds.delete(event.id);
    }
  }

  finishItem(event) {
    const run = this.ensureRun();
    const item = this.ensureItem(event);
    if (!run || !item) {
      return;
    }
    const childResult = event.type === "suiteFinished"
      ? summarizeChildResults(this.childResults.get(event.id))
      : undefined;
    if (childResult) {
      this.childResults.delete(event.id);
      if (childResult.failed && typeof run.failed === "function") {
        run.failed(item, createMessage(this.vscode, childResult.message || ""), event.duration);
        return "failed";
      }
      if (childResult.skipped && !childResult.passed && typeof run.skipped === "function") {
        run.skipped(item, createOptionalMessage(this.vscode, childResult.message));
        return "skipped";
      }
    }
    const pending = this.pendingResults.get(event.id);
    this.pendingResults.delete(event.id);
    if (pending && pending.status === "failed" && typeof run.failed === "function") {
      this.recordChildResult(event, "failed", pending.message);
      run.failed(item, createMessage(this.vscode, pending.message), event.duration);
      return "failed";
    }
    if (pending && pending.status === "skipped" && typeof run.skipped === "function") {
      this.recordChildResult(event, "skipped", pending.message);
      run.skipped(item, createOptionalMessage(this.vscode, pending.message));
      return "skipped";
    }
    this.recordChildResult(event, "passed");
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
      case "suiteStarted": {
        const item = this.ensureItem(event);
        appendTestResultsOutput(run, highlightedHeading(event, "# ", ANSI_CYAN));
        if (run && item && typeof run.started === "function") {
          run.started(item);
        }
        break;
      }
      case "testStarted": {
        const attemptEvent = this.resolveAttemptEvent(event);
        const item = this.ensureItem(attemptEvent);
        appendTestResultsOutput(
          run,
          highlightedHeading(attemptEvent, "  ## ", ANSI_YELLOW),
        );
        if (run && item && typeof run.started === "function") {
          run.started(item);
        }
        break;
      }
      case "suiteFinished":
        this.finishItem(event);
        break;
      case "testFinished": {
        const attemptEvent = this.resolveAttemptEvent(event);
        const status = this.finishItem(attemptEvent);
        appendTestResultsOutput(
          run,
          highlightedResult(status),
        );
        this.forgetActiveAttempt(event);
        break;
      }
      case "testFailed": {
        const attemptEvent = this.resolveAttemptEvent(event);
        this.pendingResults.set(attemptEvent.id, {
          message: attemptEvent.message,
          status: "failed",
        });
        break;
      }
      case "testIgnored": {
        const attemptEvent = this.resolveAttemptEvent(event);
        this.pendingResults.set(attemptEvent.id, {
          message: attemptEvent.message,
          status: "skipped",
        });
        break;
      }
      case "output":
        appendTestResultsOutput(run, event.message);
        break;
      case "lineBreak":
        appendTestResultsOutput(run, "\r\n");
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
