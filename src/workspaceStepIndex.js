"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const {
  isTagSourceDocument,
  parameterEntriesFromDocument,
  tagValues,
  usedStepRecordsFromDocument,
} = require("./dynamicArgumentCompletion");
const {
  localGaugeStepReferenceEntries,
  superStepAliasesForEntry,
} = require("./gaugeReference");
const {
  allowMultilineStep,
  normalizeStepTemplate,
} = require("./stepDefinitionProvider");
const {
  GaugeStepDiagnosticsProvider,
  findConceptHeadings,
  isConceptDocument,
  isStepImplementationDocument,
} = require("./stepDiagnostics");

const GAUGE_REFERENCE_FILE_PATTERN = /\.(?:cpt|md|spec)$/i;

function documentLineText(document, line) {
  if (!document || typeof document.lineAt !== "function") {
    return "";
  }
  try {
    return document.lineAt(line).text;
  } catch (_error) {
    return "";
  }
}

function documentPath(document) {
  const uri = document && document.uri;
  return (uri && (uri.fsPath || uri.path)) || (document && document.fileName) || "";
}

function normalizedKey(value) {
  const normalized = normalizeStepTemplate(String(value || ""));
  return normalized || String(value || "").trim().normalize("NFC");
}

function isGaugeReferenceDocument(document) {
  if (!document) {
    return false;
  }
  if (["gauge", "gauge-concept"].includes(document.languageId)) {
    return true;
  }
  return GAUGE_REFERENCE_FILE_PATTERN.test(documentPath(document));
}

function emptyRecord(document) {
  return {
    concepts: [],
    document,
    parameters: undefined,
    references: [],
    stepEntries: [],
    tags: [],
    usedSteps: [],
    usedStepsByLine: new Map(),
  };
}

function emptyState(root) {
  return {
    completionEntries: [],
    conceptDefinitionsByTemplate: new Map(),
    dirtyFiles: new Set(),
    documents: [],
    fullDirty: true,
    pending: undefined,
    records: new Map(),
    referenceEntriesByTemplate: new Map(),
    root,
    semanticCompletionKeys: new Set(),
    stepAliasesByEntry: new Map(),
    stepDefinitionsByTemplate: new Map(),
    tags: [],
    usedStepOccurrencesByTemplate: new Map(),
  };
}

function addMapEntry(map, key, value) {
  if (!key) {
    return;
  }
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key).push(value);
}

class WorkspaceStepIndex {
  constructor(options = {}) {
    this.documentStore = options.documentStore;
    this.fileSystem = options.fileSystem || nodeFs;
    this.pathModule = options.pathModule || nodePath;
    this.projectFactory = options.projectFactory;
    this.vscode = options.vscode || { workspace: {} };
    this.diagnosticsProvider = options.diagnosticsProvider || new GaugeStepDiagnosticsProvider({
      documentStore: this.documentStore,
      fileSystem: this.fileSystem,
      pathModule: this.pathModule,
      projectFactory: this.projectFactory,
      vscode: this.vscode,
    });
    this.stepEntriesProvider = options.stepEntriesProvider || ((document, documents) => {
      const constants = this.diagnosticsProvider.collectWorkspaceConstants(document, documents);
      return this.diagnosticsProvider.stepFunctionsFor(document, constants);
    });
    this.referenceEntriesProvider = options.referenceEntriesProvider || ((document, root) => (
      localGaugeStepReferenceEntries(document, {
        allowMultilineStep: allowMultilineStep({
          fileSystem: this.fileSystem,
          pathModule: this.pathModule,
          projectRoot: root,
        }),
      })
    ));
    this.tagEntriesProvider = options.tagEntriesProvider || ((document) => (
      tagValues(document.getText())
    ));
    this.parameterEntriesProvider = options.parameterEntriesProvider || ((document, root) => (
      parameterEntriesFromDocument(document, {
        allowMultilineStep: allowMultilineStep({
          fileSystem: this.fileSystem,
          pathModule: this.pathModule,
          projectRoot: root,
        }),
        filePath: documentPath(document),
        fileSystem: this.fileSystem,
        pathModule: this.pathModule,
        projectRoot: root,
      })
    ));
    this.states = new Map();
    this.subscription = undefined;
    this.started = false;
    this.disposed = false;
  }

  start() {
    if (this.started || this.disposed) {
      return;
    }
    this.started = true;
    if (
      this.documentStore
      && typeof this.documentStore.onDidChangeDocuments === "function"
    ) {
      this.subscription = this.documentStore.onDidChangeDocuments((change) => {
        this.handleDocumentChange(change);
      });
    }
    if (this.documentStore && typeof this.documentStore.start === "function") {
      this.documentStore.start();
    }
  }

  dispose() {
    this.disposed = true;
    if (this.subscription && typeof this.subscription.dispose === "function") {
      this.subscription.dispose();
    }
    this.subscription = undefined;
    this.states.clear();
  }

  rootForFile(file) {
    if (
      !file
      || !this.projectFactory
      || typeof this.projectFactory.getGaugeRootFromFilePath !== "function"
    ) {
      return "";
    }
    try {
      const root = this.projectFactory.getGaugeRootFromFilePath(file);
      if (
        root
        && typeof this.projectFactory.isGaugeProject === "function"
        && this.projectFactory.isGaugeProject(root) === false
      ) {
        return undefined;
      }
      return root || "";
    } catch (_error) {
      return undefined;
    }
  }

  rootForDocument(document) {
    return this.rootForFile(documentPath(document));
  }

  belongsToRoot(document, root) {
    const candidateRoot = this.rootForDocument(document);
    return candidateRoot !== undefined && candidateRoot === root;
  }

  stateFor(root) {
    if (!this.states.has(root)) {
      this.states.set(root, emptyState(root));
    }
    return this.states.get(root);
  }

  handleDocumentChange(change) {
    const file = change && change.file;
    if (typeof this.diagnosticsProvider.bumpGenerationsForChange === "function") {
      this.diagnosticsProvider.bumpGenerationsForChange(file);
    }
    if (!file) {
      for (const state of this.states.values()) {
        state.fullDirty = true;
        state.dirtyFiles.clear();
      }
      return;
    }

    const root = this.rootForFile(file);
    for (const state of this.states.values()) {
      if (
        state.root === root
        || state.records.has(file)
        || (state.root && file.startsWith(`${state.root}${this.pathModule.sep}`))
      ) {
        state.dirtyFiles.add(file);
      }
    }
  }

  async workspaceDocumentsFor(root, sourceDocument) {
    if (!this.documentStore) {
      return [sourceDocument].filter(Boolean);
    }
    if (typeof this.documentStore.whenReady === "function") {
      await this.documentStore.whenReady();
    }
    const documents = typeof this.documentStore.documents === "function"
      ? this.documentStore.documents()
      : [];
    const result = documents.filter((document) => this.belongsToRoot(document, root));
    const sourcePath = documentPath(sourceDocument);
    if (sourceDocument && sourcePath && !result.some((document) => documentPath(document) === sourcePath)) {
      result.push(sourceDocument);
    }
    return result;
  }

  async analyzeDocument(document, documents, root) {
    const record = emptyRecord(document);
    if (isStepImplementationDocument(document)) {
      record.stepEntries = await Promise.resolve(this.stepEntriesProvider(document, documents, root));
    }
    if (isConceptDocument(document)) {
      record.concepts = findConceptHeadings(document.getText());
    }
    if (isGaugeReferenceDocument(document)) {
      record.references = await Promise.resolve(this.referenceEntriesProvider(document, root));
      const usedStepRecords = usedStepRecordsFromDocument(document, {
        allowMultilineStep: allowMultilineStep({
          fileSystem: this.fileSystem,
          pathModule: this.pathModule,
          projectRoot: root,
        }),
      });
      record.usedSteps = usedStepRecords.map((entry) => entry.label);
      for (const entry of usedStepRecords) {
        if (!record.usedStepsByLine.has(entry.line)) {
          record.usedStepsByLine.set(entry.line, []);
        }
        record.usedStepsByLine.get(entry.line).push(entry.label);
      }
    }
    if (isTagSourceDocument(document)) {
      record.tags = await Promise.resolve(this.tagEntriesProvider(document, root));
    }
    if (isGaugeReferenceDocument(document)) {
      record.parameters = await Promise.resolve(this.parameterEntriesProvider(document, root));
    }
    return record;
  }

  rebuildAggregates(state) {
    state.completionEntries = [];
    state.conceptDefinitionsByTemplate = new Map();
    state.referenceEntriesByTemplate = new Map();
    state.semanticCompletionKeys = new Set();
    state.stepDefinitionsByTemplate = new Map();
    state.tags = [];
    state.usedStepOccurrencesByTemplate = new Map();
    const completionSeen = new Set();
    const tagSeen = new Set();
    const addCompletion = (label, detail) => {
      const key = normalizedKey(label);
      if (!label || !key || completionSeen.has(key)) {
        return;
      }
      completionSeen.add(key);
      state.completionEntries.push({ detail, label });
    };

    for (const document of state.documents) {
      const record = state.records.get(documentPath(document));
      if (!record) {
        continue;
      }
      for (const heading of record.concepts) {
        addCompletion(heading.text, "concept");
        state.semanticCompletionKeys.add(normalizedKey(heading.text));
        addMapEntry(state.conceptDefinitionsByTemplate, heading.normalized, {
          document,
          heading,
          kind: "concept",
        });
      }
      for (const entry of record.stepEntries) {
        for (const alias of entry.aliases || []) {
          addCompletion(alias, "step");
          state.semanticCompletionKeys.add(normalizedKey(alias));
          addMapEntry(state.stepDefinitionsByTemplate, normalizedKey(alias), {
            document,
            entry,
            kind: "step",
          });
        }
      }
      for (const label of record.usedSteps) {
        addCompletion(label, "step");
        const key = normalizedKey(label);
        if (!state.usedStepOccurrencesByTemplate.has(key)) {
          state.usedStepOccurrencesByTemplate.set(key, new Map());
        }
        const occurrences = state.usedStepOccurrencesByTemplate.get(key);
        const file = documentPath(document);
        occurrences.set(file, (occurrences.get(file) || 0) + 1);
      }
      for (const tag of record.tags) {
        if (!tagSeen.has(tag)) {
          tagSeen.add(tag);
          state.tags.push(tag);
        }
      }
      for (const entry of record.references) {
        addMapEntry(state.referenceEntriesByTemplate, entry.template, entry);
      }
    }
  }

  async refreshState(state, sourceDocument) {
    const refreshAll = state.fullDirty;
    state.fullDirty = false;
    const dirtyFiles = new Set(state.dirtyFiles);
    state.dirtyFiles.clear();
    try {
      const documents = await this.workspaceDocumentsFor(state.root, sourceDocument);
      const currentByPath = new Map(documents.map((document) => [documentPath(document), document]));
      if (refreshAll) {
        for (const file of currentByPath.keys()) {
          dirtyFiles.add(file);
        }
      }
      const implementationDirty = refreshAll || [...dirtyFiles].some((file) => {
        const document = currentByPath.get(file) || (state.records.get(file) && state.records.get(file).document);
        return isStepImplementationDocument(document);
      });

      for (const file of [...state.records.keys()]) {
        if (!currentByPath.has(file)) {
          state.records.delete(file);
        }
      }

      if (implementationDirty) {
        state.stepAliasesByEntry = new Map();
        for (const document of documents) {
          const file = documentPath(document);
          if (isStepImplementationDocument(document) || dirtyFiles.has(file) || !state.records.has(file)) {
            state.records.set(file, await this.analyzeDocument(document, documents, state.root));
          }
        }
      } else {
        for (const file of dirtyFiles) {
          const document = currentByPath.get(file);
          if (document) {
            state.records.set(file, await this.analyzeDocument(document, documents, state.root));
          }
        }
        for (const document of documents) {
          const file = documentPath(document);
          if (!state.records.has(file)) {
            state.records.set(file, await this.analyzeDocument(document, documents, state.root));
          }
        }
      }

      state.documents = documents;
      this.rebuildAggregates(state);
      return state;
    } catch (error) {
      if (refreshAll) {
        state.fullDirty = true;
      }
      for (const file of dirtyFiles) {
        state.dirtyFiles.add(file);
      }
      throw error;
    }
  }

  async snapshotFor(sourceDocument) {
    this.start();
    const root = this.rootForDocument(sourceDocument);
    return this.snapshotForRoot(root, sourceDocument);
  }

  async snapshotForPath(file) {
    this.start();
    return this.snapshotForRoot(this.rootForFile(file));
  }

  async snapshotForRoot(root, sourceDocument) {
    if (root === undefined) {
      return emptyState(undefined);
    }
    const state = this.stateFor(root);
    if (!state.pending && !state.fullDirty && state.dirtyFiles.size === 0) {
      return state;
    }
    if (!state.pending) {
      state.pending = this.refreshState(state, sourceDocument).finally(() => {
        state.pending = undefined;
      });
    }
    await state.pending;
    if (state.pending || state.fullDirty || state.dirtyFiles.size > 0) {
      return this.snapshotForRoot(root, sourceDocument);
    }
    return state;
  }

  async completionEntries(sourceDocument, position) {
    const state = await this.snapshotFor(sourceDocument);
    if (!position || position.line === undefined) {
      return state.completionEntries.slice();
    }
    const file = documentPath(sourceDocument);
    const record = state.records.get(file);
    if (!record || !isGaugeReferenceDocument(sourceDocument)) {
      return state.completionEntries.slice();
    }
    // The document can shrink while the snapshot is awaited, and lineAt
    // throws for a line the document no longer has.
    const line = documentLineText(sourceDocument, position.line);
    const includeCurrentLine = String(line || "").slice(position.character).trim().length > 0;
    const excludedCurrentOccurrences = new Map();
    const currentLabels = includeCurrentLine
      ? []
      : record.usedStepsByLine.get(position.line) || [];
    for (const label of currentLabels) {
      const key = normalizedKey(label);
      excludedCurrentOccurrences.set(key, (excludedCurrentOccurrences.get(key) || 0) + 1);
    }
    return state.completionEntries.filter((entry) => {
      const key = normalizedKey(entry.label);
      if (state.semanticCompletionKeys.has(key)) {
        return true;
      }
      const occurrences = state.usedStepOccurrencesByTemplate.get(key);
      if (!occurrences) {
        return true;
      }
      let count = -(excludedCurrentOccurrences.get(key) || 0);
      for (const candidateCount of occurrences.values()) {
        count += candidateCount;
      }
      return count > 0;
    });
  }

  async definitionEntries(sourceDocument, templates) {
    const state = await this.snapshotFor(sourceDocument);
    const steps = [];
    const concepts = [];
    for (const template of templates || []) {
      const key = normalizedKey(template);
      steps.push(...(state.stepDefinitionsByTemplate.get(key) || []));
      concepts.push(...(state.conceptDefinitionsByTemplate.get(key) || []));
    }
    return steps.length > 0 ? steps : concepts;
  }

  async stepEntriesForDocument(sourceDocument, targetDocument = sourceDocument) {
    const state = await this.snapshotFor(sourceDocument);
    const record = state.records.get(documentPath(targetDocument));
    return record ? record.stepEntries.slice() : [];
  }

  async stepAliasesForEntry(sourceDocument, targetDocument, entry) {
    const state = await this.snapshotFor(sourceDocument);
    if (state.stepAliasesByEntry.has(entry)) {
      return state.stepAliasesByEntry.get(entry).slice();
    }
    const implementationDocuments = state.documents.filter(isStepImplementationDocument);
    const aliases = [...new Set([
      ...(entry.aliases || []),
      ...superStepAliasesForEntry(
        targetDocument,
        entry,
        implementationDocuments,
        this.diagnosticsProvider,
      ),
    ])];
    state.stepAliasesByEntry.set(entry, aliases);
    return aliases.slice();
  }

  async referenceCount(sourceDocument, template) {
    const state = await this.snapshotFor(sourceDocument);
    const entries = state.referenceEntriesByTemplate.get(normalizedKey(template)) || [];
    return entries.filter((entry) => !entry.kind || entry.kind === "step").length;
  }

  async referenceLocations(sourceDocument, template) {
    const state = await this.snapshotFor(sourceDocument);
    return (state.referenceEntriesByTemplate.get(normalizedKey(template)) || [])
      .map((entry) => entry.location);
  }

  async referenceLocationsForPath(sourcePath, template) {
    const state = await this.snapshotForPath(sourcePath);
    return (state.referenceEntriesByTemplate.get(normalizedKey(template)) || [])
      .map((entry) => entry.location);
  }

  async tagEntries(sourceDocument) {
    const state = await this.snapshotFor(sourceDocument);
    return state.tags.slice();
  }

  async parameterEntries(sourceDocument, position, argumentType) {
    const state = await this.snapshotFor(sourceDocument);
    const record = state.records.get(documentPath(sourceDocument));
    const parameters = record && record.parameters;
    if (!parameters) {
      return [];
    }
    if (argumentType === "static") {
      return parameters.staticValues.slice();
    }
    const currentLine = position && position.line;
    return [...new Set([
      ...parameters.specHeaders,
      ...(parameters.scenarioHeadersByLine.get(currentLine) || []),
      ...parameters.dynamicValues,
      ...parameters.dynamicOccurrences
        .filter((entry) => entry.line !== currentLine)
        .map((entry) => entry.value),
    ])];
  }

  async documentsFor(sourceDocument) {
    const state = await this.snapshotFor(sourceDocument);
    return state.documents.slice();
  }
}

module.exports = {
  WorkspaceStepIndex,
};
