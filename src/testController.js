"use strict";

const nodePath = require("node:path");
const { concurrencyLimit, mapWithConcurrency } = require("./asyncWork");
const { headingMarkers } = require("./gaugeHeadings");
const { isMarkdownGaugeSpecFile } = require("./gaugeSpecScope");
const { isFileSchemeDocument } = require("./workspaceDocumentStore");

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
const CANCELLED_EXECUTION = Symbol("cancelledExecution");
const DISPOSED_EXECUTION = Symbol("disposedExecution");
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

// Gauge accepts scenario identifiers ("spec.spec:3") on the same command line as
// specification paths, so a multi-target selection is one run and Before Suite,
// After Suite and the JVM start once instead of once per target.
//
// That only holds for the plain CLI, which takes each target as its own
// ARGUMENT. A Gradle or Maven run has to put them all in ONE property value, and
// Gauge accepts no delimiter inside a single path: verified against the real
// CLI, where `gauge run "specs/a.spec||specs/b.spec"` - and the same with a
// space or a comma - answers "Specs directory ... does not exist." while
// `gauge run specs/a.spec specs/b.spec` runs both. So a multi-item selection in
// a Kotlin project ran NOTHING. Until the delimiter each build plugin parses is
// established from its source, such a selection runs one target at a time.
function canBatchSpecificationTargets(targets, executionKind) {
  if (targets.length <= 1) {
    return false;
  }
  return executionKind !== "gradle" && executionKind !== "maven";
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

// A Gradle or Maven project cannot take more than one target per invocation -
// see canBatchSpecificationTargets.
function executionKindForRoot(projectFactory, projectRoot) {
  if (!projectRoot || !projectFactory || typeof projectFactory.get !== "function") {
    return undefined;
  }
  try {
    const project = projectFactory.get(projectRoot);
    return project && typeof project.executionKind === "function"
      ? project.executionKind()
      : undefined;
  } catch (_error) {
    return undefined;
  }
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

// Suite-scoped result ids are built as `${projectRoot}::<kind>:<name>`
// (src/execution/lastRunResult.js, src/execution/executor.js).
function suiteEventProjectRoot(event) {
  const id = event && typeof event.id === "string" ? event.id : "";
  const separator = id.indexOf("::");
  return separator > 0 ? id.slice(0, separator) : undefined;
}

class GaugeTestController {
  constructor(options = {}) {
    this.vscode = getVscode(options.vscode);
    this.clientsMap = options.clientsMap;
    this.executionController = options.executionController;
    this.executionRunContexts = new Set();
    this.executionDisposalPromise = new Promise((resolve) => {
      this.resolveExecutionDisposal = resolve;
    });
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
    this.workspaceDiscoveryGeneration = 0;
    this.discoveryCancellationSources = new Set();
    this.registrationDisposables = undefined;
    this.runTokenDisposables = new Map();
    this.disposed = false;
  }

  register() {
    if (this.disposed || this.registrationDisposables !== undefined) {
      return { dispose() {} };
    }
    if (!this.vscode.tests || typeof this.vscode.tests.createTestController !== "function") {
      return undefined;
    }
    this.controller = this.vscode.tests.createTestController(CONTROLLER_ID, CONTROLLER_LABEL);
    this.controller.resolveHandler = (item) => (
      item ? undefined : this.refreshWorkspaceTests()
    );
    this.controller.refreshHandler = () => this.refreshWorkspaceTests();
    this.registerRunProfiles();
    if (this.disposed || !this.controller) {
      return { dispose() {} };
    }
    const disposables = this.registerDocumentDiscovery();
    if (this.disposed || !this.controller) {
      for (const disposable of disposables) {
        disposable.dispose();
      }
      return { dispose() {} };
    }
    addDisposable(disposables, this.registerProjectChangeListener(this.projectChanges));
    if (this.disposed || !this.controller) {
      for (const disposable of disposables) {
        disposable.dispose();
      }
      return { dispose() {} };
    }
    this.registrationDisposables = disposables;
    this.discoverOpenDocuments();
    return {
      dispose: () => this.dispose(),
    };
  }

  registerRunProfiles() {
    const controller = this.controller;
    if (!controller || typeof controller.createRunProfile !== "function") {
      return;
    }
    const profileKind = this.vscode.TestRunProfileKind || {};
    controller.createRunProfile(
      RUN_PROFILE_LABEL,
      profileKind.Run,
      (request, token) => this.run(request, token),
      true,
      this.runnableTag,
    );
    if (this.disposed || this.controller !== controller) {
      return;
    }
    controller.createRunProfile(
      DEBUG_PROFILE_LABEL,
      profileKind.Debug,
      (request, token) => this.debug(request, token),
      false,
      this.runnableTag,
    );
    if (this.disposed || this.controller !== controller) {
      return;
    }
    controller.createRunProfile(
      FAILED_PROFILE_LABEL,
      profileKind.Run,
      (request, token) => this.runFailed(request, token),
      false,
      this.runnableTag,
    );
    if (this.disposed || this.controller !== controller) {
      return;
    }
    controller.createRunProfile(
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
        // Closing a diff editor must not prune the items of the file on disk.
        if (!isFileSchemeDocument(document)) {
          return;
        }
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
    if (
      this.disposed
      || !projectChanges
      || typeof projectChanges.onDidChangeProjects !== "function"
    ) {
      return undefined;
    }
    return projectChanges.onDidChangeProjects(() => this.refreshWorkspaceTests());
  }

  pruneRemovedClientWorkspaceTests() {
    if (this.disposed || !this.clientsMap || typeof this.clientsMap.values !== "function") {
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
    if (this.disposed) {
      return Promise.resolve([]);
    }
    this.pruneRemovedClientWorkspaceTests();
    return Promise.resolve(this.discoverWorkspaceTests()).catch(() => []);
  }

  discoverOpenDocuments() {
    if (this.disposed) {
      return;
    }
    const workspace = this.vscode.workspace || {};
    const documents = Array.isArray(workspace.textDocuments) ? workspace.textDocuments : [];
    for (const document of documents) {
      this.discoverDocument(document);
    }
  }

  removeDocumentItems(document, keepIds = new Set()) {
    if (this.disposed) {
      return;
    }
    const filename = documentPath(document);
    this.removePathItems(filename, keepIds);
  }

  removePathItems(filename, keepIds = new Set()) {
    if (this.disposed || !filename) {
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
    if (this.disposed || !filename) {
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
    if (this.disposed) {
      return;
    }
    collectionDelete(this.controller && this.controller.items, id);
    for (const item of this.items.values()) {
      collectionDelete(item && item.children, id);
    }
    this.items.delete(id);
    this.resultOnlyItemIds.delete(id);
  }

  cleanupResultOnlyItems() {
    if (this.disposed) {
      return;
    }
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
    if (this.disposed || !id || !this.controller) {
      return undefined;
    }
    const controller = this.controller;
    let item = this.items.get(id);
    if (!item) {
      item = controller.createTestItem(id, label || id, uri);
      if (this.disposed || this.controller !== controller) {
        return undefined;
      }
      this.items.set(id, item);
    } else if (label && label !== id) {
      item.label = label;
    }
    if (range) {
      item.range = range;
    }
    this.setItemRunnable(item, runnable);
    if (this.disposed || this.controller !== controller) {
      return undefined;
    }

    if (parentId && parentId !== ROOT_PARENT_ID) {
      const parent = this.upsertItem(parentId, parentId);
      if (this.disposed || this.controller !== controller) {
        return undefined;
      }
      collectionAdd(parent && parent.children, item);
    } else {
      collectionAdd(controller.items, item);
    }
    if (this.disposed || this.controller !== controller) {
      return undefined;
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
    if (
      this.disposed
      || !this.controller
      // A git: diff or history revision carries the same fsPath as the file on
      // disk, so discovering from one re-keys the Test Explorer items to content
      // that is not what will run.
      || !isFileSchemeDocument(document)
      || (!isGaugeSpecificationDocument(document) && !markdownSpec)
    ) {
      return [];
    }
    // Gauge reads Markdown as a specification only inside the directories named
    // by gauge_specs_dir (references/gauge/util/util.go GetSpecDirs). Without
    // this a README in a Gauge project becomes a runnable Test Explorer node and
    // pressing Run starts a Gauge process against it.
    if (
      markdownSpec
      && (
        !this.projectFactory
        || typeof this.projectFactory.getGaugeRootFromFilePath !== "function"
        || !isMarkdownGaugeSpecFile(documentPath(document), {
          fileSystem: this.fileSystem,
          pathModule: this.pathModule,
          projectFactory: this.projectFactory,
        })
      )
    ) {
      this.removeDocumentItems(document, this.workspaceDiscoveredIdsForPath(documentPath(document)));
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
    if (this.disposed) {
      return;
    }
    this.clientsMap = clientsMap;
  }

  beginWorkspaceDiscovery() {
    this.workspaceDiscoveryGeneration += 1;
    return this.workspaceDiscoveryGeneration;
  }

  hasWorkspaceClient(client) {
    if (!this.clientsMap || typeof this.clientsMap.values !== "function") {
      return false;
    }
    for (const entry of this.clientsMap.values()) {
      if (entry && entry.client === client) {
        return true;
      }
    }
    return false;
  }

  isCurrentWorkspaceDiscovery(generation, client) {
    return !this.disposed
      && generation === this.workspaceDiscoveryGeneration
      && (client === undefined || this.hasWorkspaceClient(client));
  }

  async discoverWorkspaceTests() {
    if (this.disposed) {
      return [];
    }
    const generation = this.beginWorkspaceDiscovery();
    if (
      !this.controller
      || !this.clientsMap
      || typeof this.clientsMap.values !== "function"
    ) {
      return [];
    }
    const discovered = [];
    const entries = [...this.clientsMap.values()];
    for (const entry of entries) {
      const client = entry && entry.client;
      if (!client || typeof client.sendRequest !== "function") {
        continue;
      }
      const clientTests = await this.discoverClientTests(client, generation);
      if (!this.isCurrentWorkspaceDiscovery(generation)) {
        return [];
      }
      discovered.push(...clientTests);
    }
    return discovered;
  }

  createDiscoveryCancellationSource() {
    if (this.disposed || typeof this.vscode.CancellationTokenSource !== "function") {
      return undefined;
    }
    const source = new this.vscode.CancellationTokenSource();
    this.discoveryCancellationSources.add(source);
    return source;
  }

  releaseDiscoveryCancellationSource(source) {
    if (!source || !this.discoveryCancellationSources.delete(source)) {
      return;
    }
    if (typeof source.dispose === "function") {
      source.dispose();
    }
  }

  async discoverClientTests(client, discoveryGeneration) {
    if (this.disposed || !client || typeof client.sendRequest !== "function") {
      return [];
    }
    const generation = discoveryGeneration === undefined
      ? this.beginWorkspaceDiscovery()
      : discoveryGeneration;
    if (!this.isCurrentWorkspaceDiscovery(generation, client)) {
      return [];
    }
    const cancellation = this.createDiscoveryCancellationSource();
    const token = cancellation && cancellation.token;
    try {
      let specs;
      try {
        specs = await client.sendRequest(SPECS_REQUEST, {}, token);
      } catch (_error) {
        return [];
      }
      if (
        !this.isCurrentWorkspaceDiscovery(generation, client)
        || cancellationRequested(token)
      ) {
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
          if (
            !this.isCurrentWorkspaceDiscovery(generation, client)
            || cancellationRequested(token)
          ) {
            return [];
          }
          let request;
          try {
            request = client.sendRequest(
              SCENARIOS_REQUEST,
              {
                textDocument: { uri: spec.executionIdentifier },
                position: createPosition(this.vscode, 1, 1),
              },
              token,
            );
          } catch (_error) {
            return [];
          }
          return Promise.resolve(request)
            .then((response) => (
              !this.isCurrentWorkspaceDiscovery(generation, client)
                || cancellationRequested(token)
                ? []
                : response
            ))
            .catch(() => []);
        },
      );
      if (
        !this.isCurrentWorkspaceDiscovery(generation, client)
        || cancellationRequested(token)
      ) {
        return [];
      }
      for (const [specIndex, spec] of specEntries.entries()) {
        if (!this.isCurrentWorkspaceDiscovery(generation, client)) {
          return [];
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

        const scenarioResponse = scenarioLists[specIndex];
        const scenarios = Array.isArray(scenarioResponse)
          ? scenarioResponse
          : scenarioResponse
            ? [scenarioResponse]
            : [];
        for (const scenario of scenarios) {
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
      if (
        !this.isCurrentWorkspaceDiscovery(generation, client)
        || cancellationRequested(token)
      ) {
        return [];
      }
      this.pruneWorkspaceDiscoveredItems(client, discoveredIds);
      this.workspaceDiscoveredIdsByClient.set(client, discoveredIds);
      return discovered;
    } finally {
      this.releaseDiscoveryCancellationSource(cancellation);
    }
  }

  pruneWorkspaceDiscoveredItems(client, discoveredIds) {
    if (this.disposed) {
      return;
    }
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
    if (this.disposed) {
      return;
    }
    this.executionController = executionController;
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.workspaceDiscoveryGeneration += 1;
    const resolveExecutionDisposal = this.resolveExecutionDisposal;
    this.resolveExecutionDisposal = undefined;
    if (resolveExecutionDisposal) {
      resolveExecutionDisposal(DISPOSED_EXECUTION);
    }

    const currentRun = this.currentRun;
    const activeRunContext = this.activeRunContext;
    const activeRun = activeRunContext && activeRunContext.run;
    for (const context of [...this.executionRunContexts]) {
      context.cancelled = true;
      this.finishRunContext(context);
    }
    this.executionRunContexts.clear();
    if (
      currentRun
      && activeRun !== currentRun
      && typeof currentRun.end === "function"
    ) {
      currentRun.end();
    }
    this.releaseAllRunTokenCancellations();
    this.activeRunContext = undefined;
    this.currentRun = undefined;
    this.currentRequest = undefined;
    this.pendingResults.clear();
    this.resultOnlyItemIds.clear();
    this.attemptCounts.clear();
    this.activeAttemptIds.clear();
    this.forwardedOutput = undefined;
    this.testOutputShown = false;
    this.executionController = undefined;

    for (const source of [...this.discoveryCancellationSources]) {
      this.discoveryCancellationSources.delete(source);
      if (typeof source.cancel === "function") {
        source.cancel();
      }
      if (typeof source.dispose === "function") {
        source.dispose();
      }
    }

    const controller = this.controller;
    this.controller = undefined;
    if (controller) {
      controller.resolveHandler = undefined;
      controller.refreshHandler = undefined;
      if (controller.items && typeof controller.items.replace === "function") {
        controller.items.replace([]);
      }
    }
    this.items.clear();
    this.workspaceDiscoveredIdsByClient.clear();
    this.clientsMap = undefined;

    const disposables = this.registrationDisposables || [];
    this.registrationDisposables = undefined;
    for (const disposable of disposables) {
      disposable.dispose();
    }
    if (controller && typeof controller.dispose === "function") {
      controller.dispose();
    }
  }

  createRunContext(request) {
    const context = {
      activeCommand: undefined,
      cancelled: false,
      cancellationDisposable: undefined,
      ended: false,
      hostCancellationRequested: false,
      request,
      run: undefined,
    };
    this.executionRunContexts.add(context);
    return context;
  }

  createExecutionCommand(context) {
    let resolveCancellation;
    const command = {
      cancellationPromise: new Promise((resolve) => {
        resolveCancellation = resolve;
      }),
      resolveCancellation,
      settled: false,
      started: false,
      stopRequested: false,
    };
    command.metadata = {
      isCancellationRequested: () => (
        this.disposed
        || !context
        || context.ended
        || context.hostCancellationRequested
      ),
      onCancelled: () => {
        context.cancelled = true;
        this.cancelExecutionCommand(context, command);
      },
      onStart: () => {
        this.startExecutionCommand(context, command);
      },
      onSuperseded: () => {
        context.cancelled = true;
        this.cancelExecutionCommand(context, command);
      },
    };
    context.activeCommand = command;
    return command;
  }

  resolveExecutionCommand(command, value = CANCELLED_EXECUTION) {
    if (!command || !command.resolveCancellation) {
      return;
    }
    const resolveCancellation = command.resolveCancellation;
    command.resolveCancellation = undefined;
    resolveCancellation(value);
  }

  cancelExecutionCommand(context, command) {
    if (!command || command.settled || context.activeCommand !== command) {
      return;
    }
    if (command.started) {
      command.stopRequested = true;
      return;
    }
    this.resolveExecutionCommand(command);
  }

  stopExecutionCommand(context, command) {
    if (
      this.disposed
      || !context
      || context.ended
      || context.activeCommand !== command
      || !command.started
      || !context.hostCancellationRequested
      || command.stopRequested
    ) {
      return;
    }
    command.stopRequested = true;
    this.stopExecution();
  }

  startExecutionCommand(context, command) {
    if (
      this.disposed
      || !context
      || context.ended
      || context.activeCommand !== command
      || command.settled
      || command.started
    ) {
      return;
    }
    command.started = true;
    if (context.hostCancellationRequested) {
      this.stopExecutionCommand(context, command);
      return;
    }
    this.activateRunContext(context);
  }

  finishExecutionCommand(context, command) {
    if (!command || command.settled) {
      return;
    }
    command.settled = true;
    command.started = false;
    this.resolveExecutionCommand(command);
    if (context && context.activeCommand === command) {
      context.activeCommand = undefined;
    }
  }

  releaseRunCancellation(context) {
    if (!context || !context.cancellationDisposable) {
      return;
    }
    const disposable = context.cancellationDisposable;
    context.cancellationDisposable = undefined;
    if (typeof disposable.dispose === "function") {
      try {
        disposable.dispose();
      } catch (_error) {
        // Host cancellation cleanup must not replace the execution outcome.
      }
    }
  }

  activateRunContext(context) {
    if (this.disposed || !context || context.ended || this.activeRunContext === context) {
      return;
    }
    if (this.activeRunContext) {
      this.finishRunContext(this.activeRunContext);
    }
    // A run created outside the Test Explorer has no context, so nothing else
    // ends it. Overwriting currentRun below would leave it open for the rest of
    // the session with its cancellation listener still registered.
    this.endContextlessRun(this.currentRun);
    this.activeRunContext = context;
    this.prepareTestRun(context.request);
    this.currentRun = context.run;
  }

  finishRunContext(context) {
    if (!context) {
      return;
    }
    this.executionRunContexts.delete(context);
    const wasEnded = context.ended;
    const run = context.run;
    const wasActive = this.activeRunContext === context;
    context.ended = true;
    this.finishExecutionCommand(context, context.activeCommand);
    context.request = undefined;
    context.run = undefined;
    if (wasActive) {
      this.cleanupResultOnlyItems();
      this.activeRunContext = undefined;
      this.currentRun = undefined;
      this.currentRequest = undefined;
    }
    this.releaseRunCancellation(context);
    this.releaseRunTokenCancellation(run);
    if (!wasEnded && run && typeof run.end === "function") {
      run.end();
    }
  }

  handleExecutionCommand(context, command, ...args) {
    if (
      this.disposed
      || !context
      || context.ended
      || context.hostCancellationRequested
      || !this.executionController
    ) {
      return DISPOSED_EXECUTION;
    }
    const executionCommand = this.createExecutionCommand(context);
    let commandResult;
    try {
      if (typeof this.executionController.handleCommandWithMetadata === "function") {
        commandResult = this.executionController.handleCommandWithMetadata(
          command,
          executionCommand.metadata,
          ...args,
        );
      } else {
        this.activateRunContext(context);
        if (this.disposed || context.ended || context.cancelled) {
          this.finishExecutionCommand(context, executionCommand);
          return DISPOSED_EXECUTION;
        }
        commandResult = this.executionController.handleCommand(command, ...args);
        this.startExecutionCommand(context, executionCommand);
      }
    } catch (error) {
      this.finishExecutionCommand(context, executionCommand);
      if (this.disposed || context.ended || context.hostCancellationRequested) {
        return DISPOSED_EXECUTION;
      }
      throw error;
    }
    const observedResult = Promise.resolve(commandResult).catch((error) => {
      if (this.disposed || context.ended || context.cancelled) {
        return CANCELLED_EXECUTION;
      }
      throw error;
    });
    if (this.disposed || context.ended) {
      observedResult.catch(() => {});
      this.finishExecutionCommand(context, executionCommand);
      return DISPOSED_EXECUTION;
    }
    const outcomes = [observedResult, executionCommand.cancellationPromise];
    if (this.executionDisposalPromise) {
      outcomes.push(this.executionDisposalPromise);
    }
    return Promise.race(outcomes).finally(() => {
      this.finishExecutionCommand(context, executionCommand);
    });
  }

  runContextCancelled(context, token) {
    return this.disposed
      || !context
      || context.ended
      || context.cancelled
      || cancellationRequested(token);
  }

  testItemForTarget(target) {
    if (this.disposed) {
      return undefined;
    }
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
    if (this.disposed) {
      return undefined;
    }
    const item = this.testItemForTarget(target);
    if (this.disposed) {
      return undefined;
    }
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
    if (this.disposed) {
      return;
    }
    this.cleanupResultOnlyItems();
    this.currentRequest = request;
    this.pendingResults.clear();
    this.attemptCounts.clear();
    this.activeAttemptIds.clear();
    this.testOutputShown = false;
  }

  startTestRun(request = {}) {
    if (this.disposed) {
      return undefined;
    }
    this.prepareTestRun(request);
    this.forwardedOutput = new Set();
    if (!this.controller || typeof this.controller.createTestRun !== "function") {
      return undefined;
    }
    const run = this.controller.createTestRun(request);
    if (this.disposed) {
      if (run && typeof run.end === "function") {
        run.end();
      }
      return undefined;
    }
    this.currentRun = run;
    this.observeRunCancellation(run);
    return run;
  }

  showTestOutput() {
    if (this.disposed || this.testOutputShown) {
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
    if (
      this.disposed
      || !this.executionController
      || typeof this.executionController.handleCommand !== "function"
    ) {
      return;
    }
    Promise.resolve(this.executionController.handleCommand("gauge.stopExecution")).catch(() => {});
  }

  requestHostCancellation(context) {
    if (this.disposed) {
      return;
    }
    if (!context) {
      // A run without an owning context still has to stop the Gauge process
      // the Test UI is reporting on.
      this.stopExecution();
      return;
    }
    context.cancelled = true;
    context.hostCancellationRequested = true;
    const executionCommand = context.activeCommand;
    if (executionCommand && executionCommand.started) {
      this.stopExecutionCommand(context, executionCommand);
    } else {
      this.resolveExecutionCommand(executionCommand);
    }
  }

  observeRunCancellation(run) {
    if (this.disposed || !run || this.runTokenDisposables.has(run)) {
      return;
    }
    const token = run.token;
    if (!token || typeof token.onCancellationRequested !== "function") {
      return;
    }
    let cancelled = false;
    const cancel = () => {
      if (cancelled) {
        return;
      }
      cancelled = true;
      // TestRun.token is the only cancellation signal for runs the extension
      // starts itself, such as CodeLens and spec explorer runs.
      this.requestHostCancellation(this.activeRunContext);
    };
    const disposable = token.onCancellationRequested(cancel);
    this.runTokenDisposables.set(run, disposable);
    if (token.isCancellationRequested) {
      cancel();
    }
    if (this.disposed) {
      this.releaseRunTokenCancellation(run);
    }
  }

  releaseRunTokenCancellation(run) {
    const disposable = run && this.runTokenDisposables.get(run);
    if (!disposable) {
      return;
    }
    this.runTokenDisposables.delete(run);
    if (typeof disposable.dispose === "function") {
      try {
        disposable.dispose();
      } catch (_error) {
        // Host cancellation cleanup must not replace the execution outcome.
      }
    }
  }

  releaseAllRunTokenCancellations() {
    for (const run of [...this.runTokenDisposables.keys()]) {
      this.releaseRunTokenCancellation(run);
    }
  }

  registerCancellation(token, context) {
    if (
      this.disposed
      || !token
      || typeof token.onCancellationRequested !== "function"
    ) {
      return undefined;
    }
    let cancelled = false;
    const cancel = () => {
      if (cancelled) {
        return;
      }
      cancelled = true;
      if (context) {
        this.requestHostCancellation(context);
      }
    };
    const disposable = token.onCancellationRequested(cancel);
    if (context) {
      context.cancellationDisposable = disposable;
    }
    if (token.isCancellationRequested) {
      cancel();
    }
    if (this.disposed || !context || context.ended || context.cancelled) {
      this.releaseRunCancellation(context);
      return undefined;
    }
    return disposable;
  }

  async runWithFlags(request = {}, flags = testUiRunFlags(), token) {
    if (this.disposed) {
      return undefined;
    }
    const context = this.createRunContext(request);
    this.registerCancellation(token, context);
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
          // The count that decides is the whole selection, as before; a build
          // tool anywhere in it disqualifies batching, because such a group
          // would have to join its targets into one property value.
          const buildToolKind = targetGroups
            .map((group) => executionKindForRoot(this.projectFactory, group.projectRoot))
            .find((kind) => kind === "gradle" || kind === "maven");
          if (canBatchSpecificationTargets(runnableTargets, buildToolKind)) {
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
    if (this.disposed) {
      return undefined;
    }
    const context = this.createRunContext(request);
    this.registerCancellation(token, context);
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
    if (this.disposed) {
      return undefined;
    }
    if (!this.currentRun) {
      const request = this.currentRequest || {};
      if (this.currentRequest === undefined) {
        this.prepareTestRun(request);
      }
      const controller = this.controller;
      if (controller && typeof controller.createTestRun === "function") {
        const run = controller.createTestRun(request);
        if (this.disposed) {
          if (run && typeof run.end === "function") {
            run.end();
          }
          return undefined;
        }
        this.currentRun = run;
        if (this.activeRunContext) {
          this.activeRunContext.run = run;
        }
        this.observeRunCancellation(run);
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
    if (this.disposed || !id || !this.controller) {
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
    if (this.disposed || !item) {
      return undefined;
    }
    this.setItemRunnable(item, !event.resultOnly);
    if (this.disposed) {
      return undefined;
    }
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
      // A data-table row id is "<spec>:<line>_<row>"
      // (src/execution/lineProcessors.js tableIdentifier), so it names the
      // scenario that owns it. Without this every selected scenario's rows were
      // parented under the FIRST selected scenario and the rest showed nothing.
      const owner = included.find((item) => (
        event.id === item.id || String(event.id || "").startsWith(`${item.id}_`)
      ));
      if (owner) {
        return owner.id;
      }
      const descendant = included.find((item) => item.id.startsWith(`${parentId}:`));
      if (descendant) {
        return descendant.id;
      }
    }
    // A suite-scoped result names its project root in the event id
    // (src/execution/lastRunResult.js suiteHookEvents and
    // src/execution/executor.js unexpectedEndEvents both build
    // `${projectRoot}::...`). Falling straight to included[0] hung one project's
    // suite failure under another project's specification.
    const projectRoot = suiteEventProjectRoot(event);
    if (projectRoot) {
      const owned = included.find((item) => item.id.startsWith(`${projectRoot}/`));
      if (owned) {
        return owned.id;
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
    const text = String(message || "").trim();
    if (!run || typeof run.appendOutput !== "function" || !text) {
      return;
    }
    // Gauge already prints its validation errors on stdout, which test UI runs
    // stream into the same panel, so repeating one here would show it twice.
    if (this.forwardedOutput && this.forwardedOutput.has(text)) {
      return;
    }
    run.appendOutput(
      `${testResultsOutput(text)}\r\n`,
      createMessageLocation(this.vscode, location),
      item,
    );
  }

  rememberForwardedOutput(message) {
    const text = String(message || "");
    if (!text.trim()) {
      return;
    }
    if (!this.forwardedOutput) {
      this.forwardedOutput = new Set();
    }
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) {
        this.forwardedOutput.add(trimmed.replace(/^\[ValidationError\]\s*/, ""));
      }
    }
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

  // A passing later attempt deliberately does NOT clear the logical item.
  // Gauge's serial reporter gives every row of a nested data table the same
  // event id - references/gauge/reporter/jsonConsole.go only appends the row
  // when isParallel, and getTable returns just the scenario row index - so a
  // second spec row is indistinguishable here from a retry of the first.
  // Clearing on a pass therefore turned a genuinely failed row green while Gauge
  // exited non-zero. Leaving a retried scenario red understates a pass, which is
  // the safe direction; showing a failure as passed is not.

  showNotification(event) {
    if (this.disposed) {
      return;
    }
    const text = notificationText(event);
    const window = this.vscode.window || {};
    const method = notificationMethod(event && event.severity);
    if (text && typeof window[method] === "function") {
      window[method](text);
    }
  }

  endContextlessRun(run) {
    if (!run || this.activeRunContext || this.currentRun !== run) {
      return;
    }
    this.currentRun = undefined;
    this.currentRequest = undefined;
    this.releaseRunTokenCancellation(run);
    if (typeof run.end === "function") {
      run.end();
    }
  }

  handleExecutionEvent(event) {
    if (this.disposed || !event || !event.type) {
      return;
    }
    const run = this.ensureRun();
    if (this.disposed) {
      return;
    }
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
        if (!this.disposed && run && item && typeof run.started === "function") {
          run.started(item);
        }
        break;
      }
      case "suiteFinished":
        // A run started outside the Test Explorer has no run context, so nothing
        // else will ever end it: the Test Results view keeps spinning after
        // Gauge exits and the cancellation listener leaks. Close it here.
        this.endContextlessRun(run);
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
        this.rememberForwardedOutput(event.message);
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
  canBatchSpecificationTargets,
  DEFAULT_SCENARIO_REQUEST_CONCURRENCY,
  GaugeTestController,
};
