const assert = require("node:assert/strict");
const test = require("node:test");

function createDocument(text, fsPath, languageId) {
  const lineStarts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      lineStarts.push(index + 1);
    }
  }
  return {
    languageId,
    uri: { fsPath, scheme: "file" },
    getText() {
      return text;
    },
    positionAt(offset) {
      let line = 0;
      while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) {
        line += 1;
      }
      return { line, character: offset - lineStarts[line] };
    },
  };
}

function createFakeVscode(textDocuments = []) {
  return {
    Diagnostic: class Diagnostic {
      constructor(range, message, severity) {
        this.range = range;
        this.message = message;
        this.severity = severity;
      }
    },
    DiagnosticSeverity: {
      Hint: "hint",
    },
    DiagnosticTag: {
      Unnecessary: "unnecessary",
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
    workspace: { textDocuments },
  };
}

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((receivedResolve, receivedReject) => {
    reject = receivedReject;
    resolve = receivedResolve;
  });
  return { promise, reject, resolve };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function diagnosticSummary(diagnostic) {
  return {
    code: diagnostic.code,
    end: { ...diagnostic.range.end },
    message: diagnostic.message,
    severity: diagnostic.severity,
    source: diagnostic.source,
    start: { ...diagnostic.range.start },
    tags: diagnostic.tags,
  };
}

test("GaugeUnusedReferenceDiagnosticsProvider fades only unreferenced concepts", async () => {
  const {
    GaugeUnusedReferenceDiagnosticsProvider,
  } = require("../src/unusedReferenceDiagnosticsProvider");
  const document = createDocument([
    "  # Reuse checkout <user>",
    "* Prepare cart",
    "",
    "# Unused concept",
    "* Prepare cart",
  ].join("\n"), "/workspace/gauge/specs/concepts/shared.cpt", "gauge-concept");
  const referenceCounts = new Map([
    ["Reuse checkout {}", 1],
    ["Unused concept", 0],
  ]);
  const provider = new GaugeUnusedReferenceDiagnosticsProvider({
    vscode: createFakeVscode([document]),
    workspaceStepIndex: {
      referenceCount(sourceDocument, template) {
        assert.equal(sourceDocument, document);
        return referenceCounts.get(template);
      },
    },
  });

  const diagnostics = await provider.provideDiagnostics(document);

  assert.deepEqual(diagnostics.map(diagnosticSummary), [
    {
      code: "gauge.unusedConcept",
      end: { line: 4, character: 14 },
      message: "Concept has no references.",
      severity: "hint",
      source: "gauge",
      start: { line: 3, character: 0 },
      tags: ["unnecessary"],
    },
  ]);
});

test("GaugeUnusedReferenceDiagnosticsProvider fades a Step declaration only when every alias is unreferenced", async () => {
  const {
    GaugeUnusedReferenceDiagnosticsProvider,
  } = require("../src/unusedReferenceDiagnosticsProvider");
  const text = [
    "@Step([\"Used alias\", \"Unused alias\"])",
    "fun mixed() {}",
    "",
    "@Step(\"Unused step\")",
    "fun unusedStep() {}",
  ].join("\n");
  const document = createDocument(
    text,
    "/workspace/gauge/src/test/kotlin/Steps.kt",
    "kotlin",
  );
  const mixedStart = text.indexOf("fun mixed");
  const unusedStart = text.indexOf("fun unusedStep");
  const mixedEntry = {
    declarationEnd: mixedStart + "fun mixed()".length,
    declarationStart: mixedStart,
  };
  const unusedEntry = {
    declarationEnd: unusedStart + "fun unusedStep()".length,
    declarationStart: unusedStart,
  };
  const provider = new GaugeUnusedReferenceDiagnosticsProvider({
    vscode: createFakeVscode([document]),
    workspaceStepIndex: {
      referenceCount(_sourceDocument, template) {
        return template === "Used alias" ? 1 : 0;
      },
      stepAliasesForEntry(_sourceDocument, _targetDocument, entry) {
        return entry === mixedEntry
          ? ["Used alias", "Unused alias"]
          : ["Unused step"];
      },
      stepEntriesForDocument() {
        return [mixedEntry, unusedEntry];
      },
    },
  });

  const diagnostics = await provider.provideDiagnostics(document);

  assert.deepEqual(diagnostics.map(diagnosticSummary), [
    {
      code: "gauge.unusedStepImplementation",
      end: { line: 4, character: 19 },
      message: "Step implementation has no references.",
      severity: "hint",
      source: "gauge",
      start: { line: 4, character: 0 },
      tags: ["unnecessary"],
    },
  ]);
});

test("GaugeUnusedReferenceDiagnosticsProvider uses the shared index for concept Kotlin and Java references", async () => {
  const {
    GaugeUnusedReferenceDiagnosticsProvider,
  } = require("../src/unusedReferenceDiagnosticsProvider");
  const { WorkspaceStepIndex } = require("../src/workspaceStepIndex");
  const conceptDocument = createDocument([
    "# Used concept <user>",
    "* Nested support",
    "",
    "# Unused concept",
    "* Nested support",
  ].join("\n"), "/workspace/gauge/specs/concepts/shared.cpt", "gauge-concept");
  const specDocument = createDocument([
    "# Checkout",
    "* Used concept \"Alice\"",
    "* Used Kotlin step",
    "* Used Java step",
  ].join("\n"), "/workspace/gauge/specs/checkout.spec", "gauge");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Used Kotlin step\")",
    "fun usedKotlinStep() {}",
    "",
    "@Step(\"Unused Kotlin step\")",
    "fun unusedKotlinStep() {}",
  ].join("\n"), "/workspace/gauge/src/test/kotlin/Steps.kt", "kotlin");
  const javaDocument = createDocument([
    "import com.thoughtworks.gauge.Step;",
    "",
    "class Steps {",
    "  @Step(\"Used Java step\")",
    "  void usedJavaStep() {}",
    "  @Step(\"Unused Java step\")",
    "  void unusedJavaStep() {}",
    "}",
  ].join("\n"), "/workspace/gauge/src/test/java/Steps.java", "java");
  const documents = [conceptDocument, specDocument, kotlinDocument, javaDocument];
  const documentStore = {
    documents() {
      return documents;
    },
    onDidChangeDocuments() {
      return { dispose() {} };
    },
    start() {},
    whenReady() {
      return Promise.resolve();
    },
  };
  const projectFactory = {
    getGaugeRootFromFilePath() {
      return "/workspace/gauge";
    },
    isGaugeProject() {
      return true;
    },
  };
  const vscode = createFakeVscode(documents);
  const workspaceStepIndex = new WorkspaceStepIndex({
    documentStore,
    projectFactory,
    vscode,
  });
  const provider = new GaugeUnusedReferenceDiagnosticsProvider({
    documentStore,
    vscode,
    workspaceStepIndex,
  });

  const [conceptDiagnostics, kotlinDiagnostics, javaDiagnostics] = await Promise.all([
    provider.provideDiagnostics(conceptDocument),
    provider.provideDiagnostics(kotlinDocument),
    provider.provideDiagnostics(javaDocument),
  ]);

  assert.deepEqual(conceptDiagnostics.map((diagnostic) => diagnostic.code), [
    "gauge.unusedConcept",
  ]);
  assert.deepEqual(kotlinDiagnostics.map((diagnostic) => diagnostic.code), [
    "gauge.unusedStepImplementation",
  ]);
  assert.deepEqual(javaDiagnostics.map((diagnostic) => diagnostic.code), [
    "gauge.unusedStepImplementation",
  ]);
  assert.deepEqual({ ...conceptDiagnostics[0].range.start }, { line: 3, character: 0 });
  assert.deepEqual({ ...conceptDiagnostics[0].range.end }, { line: 4, character: 16 });
  assert.deepEqual({ ...kotlinDiagnostics[0].range.start }, { line: 5, character: 0 });
  assert.deepEqual({ ...kotlinDiagnostics[0].range.end }, { line: 6, character: 25 });
  assert.deepEqual({ ...javaDiagnostics[0].range.start }, { line: 5, character: 2 });
  assert.deepEqual({ ...javaDiagnostics[0].range.end }, { line: 6, character: 26 });
  workspaceStepIndex.dispose();
});

test("GaugeUnusedReferenceDiagnosticsProvider refreshes fading after reference changes", async () => {
  const {
    GaugeUnusedReferenceDiagnosticsProvider,
  } = require("../src/unusedReferenceDiagnosticsProvider");
  const document = createDocument(
    "# Shared checkout\n* Prepare cart",
    "/workspace/gauge/specs/concepts/shared.cpt",
    "gauge-concept",
  );
  const listeners = new Set();
  const documentStore = {
    onDidChangeDocuments(listener) {
      listeners.add(listener);
      return { dispose() { listeners.delete(listener); } };
    },
    start() {},
  };
  let referenceCount = 0;
  const sets = [];
  const vscode = createFakeVscode([document]);
  vscode.languages = {
    createDiagnosticCollection(name) {
      return {
        delete() {},
        dispose() {},
        set(uri, diagnostics) {
          sets.push({ diagnostics, name, uri });
        },
      };
    },
  };
  const provider = new GaugeUnusedReferenceDiagnosticsProvider({
    documentStore,
    refreshDelayMs: 0,
    vscode,
    workspaceStepIndex: {
      referenceCount() {
        return referenceCount;
      },
    },
  });

  const disposable = provider.register();
  await provider.waitForPendingRefresh();
  assert.equal(sets.at(-1).diagnostics.length, 1);

  referenceCount = 1;
  for (const listener of listeners) {
    listener({ file: "/workspace/gauge/specs/checkout.spec" });
  }
  await provider.waitForPendingRefresh();

  assert.deepEqual(sets.at(-1).diagnostics, []);
  disposable.dispose();
});

test("GaugeUnusedReferenceDiagnosticsProvider settles overlapping refreshes and ignores retained listeners after disposal", async () => {
  const {
    GaugeUnusedReferenceDiagnosticsProvider,
  } = require("../src/unusedReferenceDiagnosticsProvider");
  const document = createDocument(
    "@Step(\"Unused step\")\nfun unusedStep() {}",
    "/workspace/gauge/src/test/kotlin/Steps.kt",
    "kotlin",
  );
  const entriesGate = deferred();
  const entriesEntered = deferred();
  let stepEntryCalls = 0;
  let aliasCalls = 0;
  let referenceCalls = 0;
  let changeListener;
  let closeListener;
  let collectionCreations = 0;
  let collectionDisposals = 0;
  let changeSubscriptionDisposals = 0;
  let closeSubscriptionDisposals = 0;
  let deleteCalls = 0;
  let setCalls = 0;
  const documentStore = {
    disposeCalls: 0,
    onDidChangeDocuments(listener) {
      changeListener = listener;
      return {
        dispose() {
          changeSubscriptionDisposals += 1;
        },
      };
    },
    start() {},
  };
  const vscode = createFakeVscode([document]);
  vscode.languages = {
    createDiagnosticCollection() {
      collectionCreations += 1;
      return {
        delete() {
          deleteCalls += 1;
        },
        dispose() {
          collectionDisposals += 1;
        },
        set() {
          setCalls += 1;
        },
      };
    },
  };
  vscode.workspace.onDidCloseTextDocument = (listener) => {
    closeListener = listener;
    return {
      dispose() {
        closeSubscriptionDisposals += 1;
      },
    };
  };
  const workspaceStepIndex = {
    disposeCalls: 0,
    referenceCount() {
      referenceCalls += 1;
      return 0;
    },
    stepAliasesForEntry() {
      aliasCalls += 1;
      return ["Unused step"];
    },
    stepEntriesForDocument() {
      stepEntryCalls += 1;
      entriesEntered.resolve();
      return entriesGate.promise;
    },
  };
  const provider = new GaugeUnusedReferenceDiagnosticsProvider({
    documentStore,
    refreshDelayMs: 0,
    vscode,
    workspaceStepIndex,
  });
  const registration = provider.register();
  const firstRefresh = provider.waitForPendingRefresh();
  await entriesEntered.promise;
  changeListener({ file: document.uri.fsPath });
  const secondRefresh = provider.waitForPendingRefresh();
  let firstSettled = false;
  let secondSettled = false;
  firstRefresh.then(() => {
    firstSettled = true;
  });
  secondRefresh.then(() => {
    secondSettled = true;
  });

  registration.dispose();
  registration.dispose();
  await Promise.resolve();
  const settledAtDisposal = { firstSettled, secondSettled };
  const timerAtDisposal = provider.refreshTimer;
  const pendingAtDisposal = provider.pendingRefreshPromise;
  const repeatedRegistration = provider.register();
  changeListener({ file: document.uri.fsPath });
  closeListener(document);
  const directDiagnosticsPromise = provider.provideDiagnostics(document);
  let directDiagnosticsSettled = false;
  directDiagnosticsPromise.then(() => {
    directDiagnosticsSettled = true;
  });
  await Promise.resolve();
  const directDiagnosticsSettledAtDisposal = directDiagnosticsSettled;
  const timerAfterRetainedCallbacks = provider.refreshTimer;
  if (timerAfterRetainedCallbacks !== undefined) {
    clearTimeout(timerAfterRetainedCallbacks);
    provider.refreshTimer = undefined;
  }
  entriesGate.resolve([{
    declarationEnd: document.getText().length,
    declarationStart: document.getText().indexOf("fun"),
  }]);
  const [, , directDiagnostics] = await Promise.all([
    firstRefresh,
    secondRefresh,
    directDiagnosticsPromise,
  ]);
  await nextTurn();

  assert.equal(registration, provider);
  assert.equal(repeatedRegistration, provider);
  assert.deepEqual(settledAtDisposal, { firstSettled: true, secondSettled: true });
  assert.equal(timerAtDisposal, undefined);
  assert.equal(pendingAtDisposal, undefined);
  assert.equal(timerAfterRetainedCallbacks, undefined);
  assert.equal(directDiagnosticsSettledAtDisposal, true);
  assert.deepEqual(directDiagnostics, []);
  assert.deepEqual({
    aliasCalls,
    changeSubscriptionDisposals,
    closeSubscriptionDisposals,
    collectionCreations,
    collectionDisposals,
    deleteCalls,
    referenceCalls,
    setCalls,
    stepEntryCalls,
  }, {
    aliasCalls: 0,
    changeSubscriptionDisposals: 1,
    closeSubscriptionDisposals: 1,
    collectionCreations: 1,
    collectionDisposals: 1,
    deleteCalls: 0,
    referenceCalls: 0,
    setCalls: 0,
    stepEntryCalls: 1,
  });
  assert.equal(documentStore.disposeCalls, 0);
  assert.equal(workspaceStepIndex.disposeCalls, 0);
});

test("GaugeUnusedReferenceDiagnosticsProvider stops indexed continuation after disposal", async () => {
  const {
    GaugeUnusedReferenceDiagnosticsProvider,
  } = require("../src/unusedReferenceDiagnosticsProvider");
  const document = createDocument(
    "@Step(\"Unused step\")\nfun unusedStep() {}",
    "/workspace/gauge/src/test/kotlin/Steps.kt",
    "kotlin",
  );
  const aliasesGate = deferred();
  const aliasesEntered = deferred();
  let referenceCalls = 0;
  let setCalls = 0;
  const vscode = createFakeVscode([document]);
  vscode.languages = {
    createDiagnosticCollection() {
      return {
        delete() {},
        dispose() {},
        set() {
          setCalls += 1;
        },
      };
    },
  };
  const provider = new GaugeUnusedReferenceDiagnosticsProvider({
    refreshDelayMs: 0,
    vscode,
    workspaceStepIndex: {
      referenceCount() {
        referenceCalls += 1;
        return 0;
      },
      stepAliasesForEntry() {
        aliasesEntered.resolve();
        return aliasesGate.promise;
      },
      stepEntriesForDocument() {
        return [{
          declarationEnd: document.getText().length,
          declarationStart: document.getText().indexOf("fun"),
        }];
      },
    },
  });
  const registration = provider.register();
  const refresh = provider.waitForPendingRefresh();
  await aliasesEntered.promise;

  registration.dispose();
  let refreshSettled = false;
  refresh.then(() => {
    refreshSettled = true;
  });
  await Promise.resolve();
  const settledBeforeAliases = refreshSettled;
  aliasesGate.resolve(["Unused step"]);
  await refresh;
  await nextTurn();

  assert.equal(settledBeforeAliases, true);
  assert.equal(referenceCalls, 0);
  assert.equal(setCalls, 0);
});

test("GaugeUnusedReferenceDiagnosticsProvider observes rejected index work after disposal", async () => {
  const {
    GaugeUnusedReferenceDiagnosticsProvider,
  } = require("../src/unusedReferenceDiagnosticsProvider");
  const document = createDocument(
    "@Step(\"Unused step\")\nfun unusedStep() {}",
    "/workspace/gauge/src/test/kotlin/Steps.kt",
    "kotlin",
  );
  const entriesGate = deferred();
  const entriesEntered = deferred();
  let aliasCalls = 0;
  let setCalls = 0;
  const vscode = createFakeVscode([document]);
  vscode.languages = {
    createDiagnosticCollection() {
      return {
        delete() {},
        dispose() {},
        set() {
          setCalls += 1;
        },
      };
    },
  };
  const provider = new GaugeUnusedReferenceDiagnosticsProvider({
    refreshDelayMs: 0,
    vscode,
    workspaceStepIndex: {
      referenceCount() {
        return 0;
      },
      stepAliasesForEntry() {
        aliasCalls += 1;
        return ["Unused step"];
      },
      stepEntriesForDocument() {
        entriesEntered.resolve();
        return entriesGate.promise;
      },
    },
  });
  const registration = provider.register();
  const refresh = provider.waitForPendingRefresh();
  await entriesEntered.promise;

  registration.dispose();
  let refreshSettled = false;
  refresh.then(() => {
    refreshSettled = true;
  });
  await Promise.resolve();
  const settledBeforeRejection = refreshSettled;
  entriesGate.reject(new Error("late index failure"));
  await refresh;
  await nextTurn();

  assert.equal(settledBeforeRejection, true);
  assert.equal(aliasCalls, 0);
  assert.equal(setCalls, 0);
});

test("GaugeUnusedReferenceDiagnosticsProvider preserves live index failures and neutralizes pending counts after disposal", async () => {
  const {
    GaugeUnusedReferenceDiagnosticsProvider,
  } = require("../src/unusedReferenceDiagnosticsProvider");
  const conceptDocument = createDocument(
    "# Shared concept\n* Reuse step",
    "/workspace/gauge/specs/concepts/shared.cpt",
    "gauge-concept",
  );
  const stepDocument = createDocument(
    "@Step(\"Shared step\")\nfun sharedStep() {}",
    "/workspace/gauge/src/test/kotlin/Steps.kt",
    "kotlin",
  );
  const stepEntry = {
    declarationEnd: stepDocument.getText().length,
    declarationStart: stepDocument.getText().indexOf("fun"),
  };
  const conceptError = new Error("concept index failure");
  const conceptFailureProvider = new GaugeUnusedReferenceDiagnosticsProvider({
    vscode: createFakeVscode([conceptDocument]),
    workspaceStepIndex: {
      referenceCount() {
        return Promise.reject(conceptError);
      },
    },
  });
  await assert.rejects(
    conceptFailureProvider.provideDiagnostics(conceptDocument),
    (error) => error === conceptError,
  );

  const aliasError = new Error("alias index failure");
  const aliasFailureProvider = new GaugeUnusedReferenceDiagnosticsProvider({
    vscode: createFakeVscode([stepDocument]),
    workspaceStepIndex: {
      referenceCount() {
        return 0;
      },
      stepAliasesForEntry() {
        return Promise.reject(aliasError);
      },
      stepEntriesForDocument() {
        return [stepEntry];
      },
    },
  });
  await assert.rejects(
    aliasFailureProvider.provideDiagnostics(stepDocument),
    (error) => error === aliasError,
  );

  for (const settlement of ["resolve", "reject"]) {
    for (const kind of ["concept", "step"]) {
      const countGate = deferred();
      const countEntered = deferred();
      const workspaceStepIndex = {
        disposeCalls: 0,
        referenceCount() {
          countEntered.resolve();
          return countGate.promise;
        },
        stepAliasesForEntry() {
          return ["Shared step"];
        },
        stepEntriesForDocument() {
          return [stepEntry];
        },
      };
      const provider = new GaugeUnusedReferenceDiagnosticsProvider({
        vscode: createFakeVscode([conceptDocument, stepDocument]),
        workspaceStepIndex,
      });
      const invocation = provider.provideDiagnostics(
        kind === "concept" ? conceptDocument : stepDocument,
      );
      await countEntered.promise;

      provider.dispose();
      if (settlement === "resolve") {
        countGate.resolve(0);
      } else {
        countGate.reject(new Error(`${kind} late count failure`));
      }

      assert.deepEqual(await invocation, []);
      assert.equal(workspaceStepIndex.disposeCalls, 0);
    }
  }
});

test("GaugeUnusedReferenceDiagnosticsProvider keeps the newer refresh pending when an older refresh finishes", async () => {
  const {
    GaugeUnusedReferenceDiagnosticsProvider,
  } = require("../src/unusedReferenceDiagnosticsProvider");
  const document = createDocument(
    "# Shared concept\n* Reuse step",
    "/workspace/gauge/specs/concepts/shared.cpt",
    "gauge-concept",
  );
  const firstCount = deferred();
  const secondCount = deferred();
  const firstEntered = deferred();
  const secondEntered = deferred();
  let countCalls = 0;
  let changeListener;
  const documentStore = {
    onDidChangeDocuments(listener) {
      changeListener = listener;
      return { dispose() {} };
    },
    start() {},
  };
  const vscode = createFakeVscode([document]);
  vscode.languages = {
    createDiagnosticCollection() {
      return { delete() {}, dispose() {}, set() {} };
    },
  };
  const provider = new GaugeUnusedReferenceDiagnosticsProvider({
    documentStore,
    refreshDelayMs: 0,
    vscode,
    workspaceStepIndex: {
      referenceCount() {
        countCalls += 1;
        if (countCalls === 1) {
          firstEntered.resolve();
          return firstCount.promise;
        }
        secondEntered.resolve();
        return secondCount.promise;
      },
    },
  });
  const registration = provider.register();
  const firstRefresh = provider.waitForPendingRefresh();
  await firstEntered.promise;
  changeListener({ file: document.uri.fsPath });
  const secondRefresh = provider.waitForPendingRefresh();
  await secondEntered.promise;
  let secondSettled = false;
  secondRefresh.then(() => {
    secondSettled = true;
  });

  firstCount.resolve(0);
  await firstRefresh;

  assert.notEqual(firstRefresh, secondRefresh);
  assert.equal(provider.pendingRefreshPromise, secondRefresh);
  assert.equal(provider.waitForPendingRefresh(), secondRefresh);
  assert.equal(provider.activeRefreshes.size, 1);
  assert.equal(secondSettled, false);

  secondCount.resolve(0);
  await secondRefresh;
  assert.equal(provider.pendingRefreshPromise, undefined);
  assert.equal(provider.activeRefreshes.size, 0);
  registration.dispose();
});

test("GaugeUnusedReferenceDiagnosticsProvider owns reduced and reentrant registrations exactly once", async () => {
  const {
    GaugeUnusedReferenceDiagnosticsProvider,
  } = require("../src/unusedReferenceDiagnosticsProvider");
  const document = createDocument(
    "# Shared concept\n* Reuse step",
    "/workspace/gauge/specs/concepts/shared.cpt",
    "gauge-concept",
  );
  let reducedIndexCalls = 0;
  const reducedProvider = new GaugeUnusedReferenceDiagnosticsProvider({
    vscode: createFakeVscode([document]),
    workspaceStepIndex: {
      referenceCount() {
        reducedIndexCalls += 1;
        return 0;
      },
    },
  });
  assert.equal(reducedProvider.register(), reducedProvider);
  reducedProvider.dispose();
  reducedProvider.dispose();
  assert.equal(reducedProvider.disposed, true);
  assert.deepEqual(await reducedProvider.provideDiagnostics(document), []);
  assert.equal(reducedProvider.register(), reducedProvider);
  assert.equal(reducedIndexCalls, 0);

  let constructionProvider;
  let constructedCollectionDisposals = 0;
  let constructionListenerCalls = 0;
  const constructionVscode = createFakeVscode([document]);
  constructionVscode.languages = {
    createDiagnosticCollection() {
      constructionProvider.dispose();
      return {
        dispose() {
          constructedCollectionDisposals += 1;
        },
      };
    },
  };
  constructionVscode.workspace.onDidCloseTextDocument = () => {
    constructionListenerCalls += 1;
    return { dispose() {} };
  };
  constructionProvider = new GaugeUnusedReferenceDiagnosticsProvider({
    refreshDelayMs: 60_000,
    vscode: constructionVscode,
    workspaceStepIndex: { referenceCount() { return 0; } },
  });
  assert.equal(constructionProvider.register(), constructionProvider);
  assert.equal(constructedCollectionDisposals, 1);
  assert.equal(constructionListenerCalls, 0);
  assert.equal(constructionProvider.refreshTimer, undefined);

  let cleanupProvider;
  let cleanupCollectionDisposals = 0;
  let cleanupSubscriptionDisposals = 0;
  const cleanupVscode = createFakeVscode([document]);
  cleanupVscode.languages = {
    createDiagnosticCollection() {
      return {
        dispose() {
          cleanupCollectionDisposals += 1;
          cleanupProvider.dispose();
          throw new Error("collection cleanup failure");
        },
      };
    },
  };
  const cleanupStore = {
    onDidChangeDocuments() {
      return {
        dispose() {
          cleanupSubscriptionDisposals += 1;
        },
      };
    },
    start() {},
  };
  cleanupProvider = new GaugeUnusedReferenceDiagnosticsProvider({
    documentStore: cleanupStore,
    refreshDelayMs: 60_000,
    vscode: cleanupVscode,
    workspaceStepIndex: { referenceCount() { return 0; } },
  });
  cleanupProvider.register();
  assert.doesNotThrow(() => cleanupProvider.dispose());
  cleanupProvider.dispose();
  assert.equal(cleanupCollectionDisposals, 1);
  assert.equal(cleanupSubscriptionDisposals, 1);
});

test("GaugeUnusedReferenceDiagnosticsProvider rolls back partial registration failures", () => {
  const {
    GaugeUnusedReferenceDiagnosticsProvider,
  } = require("../src/unusedReferenceDiagnosticsProvider");
  for (const stage of ["subscribe", "start"]) {
    const registrationError = new Error(`${stage} registration failure`);
    let collectionDisposals = 0;
    let subscriptionDisposals = 0;
    const vscode = createFakeVscode([]);
    vscode.languages = {
      createDiagnosticCollection() {
        return {
          dispose() {
            collectionDisposals += 1;
          },
        };
      },
    };
    const documentStore = {
      onDidChangeDocuments() {
        if (stage === "subscribe") {
          throw registrationError;
        }
        return {
          dispose() {
            subscriptionDisposals += 1;
          },
        };
      },
      start() {
        if (stage === "start") {
          throw registrationError;
        }
      },
    };
    const provider = new GaugeUnusedReferenceDiagnosticsProvider({
      documentStore,
      refreshDelayMs: 60_000,
      vscode,
      workspaceStepIndex: {},
    });

    assert.throws(() => provider.register(), (error) => error === registrationError);
    assert.equal(provider.disposed, true);
    assert.equal(collectionDisposals, 1);
    assert.equal(subscriptionDisposals, stage === "start" ? 1 : 0);
    assert.equal(provider.activeRefreshes.size, 0);
    assert.equal(provider.refreshTimer, undefined);
    assert.equal(provider.register(), provider);
  }
});

test("GaugeUnusedReferenceDiagnosticsProvider stops publication after synchronous disposal", async () => {
  const {
    GaugeUnusedReferenceDiagnosticsProvider,
  } = require("../src/unusedReferenceDiagnosticsProvider");
  const firstDocument = createDocument(
    "# First concept\n* Reuse step",
    "/workspace/gauge/specs/concepts/first.cpt",
    "gauge-concept",
  );
  const secondDocument = createDocument(
    "# Second concept\n* Reuse step",
    "/workspace/gauge/specs/concepts/second.cpt",
    "gauge-concept",
  );
  const setFiles = [];
  let registration;
  const vscode = createFakeVscode([firstDocument, secondDocument]);
  vscode.languages = {
    createDiagnosticCollection() {
      return {
        delete() {},
        dispose() {},
        set(uri) {
          setFiles.push(uri.fsPath);
          registration.dispose();
        },
      };
    },
  };
  const provider = new GaugeUnusedReferenceDiagnosticsProvider({
    refreshDelayMs: 0,
    vscode,
    workspaceStepIndex: {
      referenceCount() {
        return 0;
      },
    },
  });
  registration = provider.register();

  await provider.waitForPendingRefresh();

  assert.deepEqual(setFiles, [firstDocument.uri.fsPath]);
});

test("GaugeUnusedReferenceDiagnosticsProvider fades the whole unreferenced concept block", async () => {
  const {
    GaugeUnusedReferenceDiagnosticsProvider,
  } = require("../src/unusedReferenceDiagnosticsProvider");
  const document = createDocument([
    "## Reuse checkout <user>",
    "* Prepare cart",
    "",
    "  ## Unused concept",
    "* Prepare cart",
    "* Ship order",
    "",
    "Legacy unused concept",
    "=====================",
    "* Prepare cart",
    "",
    "",
  ].join("\n"), "/workspace/gauge/specs/concepts/shared.cpt", "gauge-concept");
  const referenceCounts = new Map([
    ["Reuse checkout {}", 1],
    ["Unused concept", 0],
    ["Legacy unused concept", 0],
  ]);
  const provider = new GaugeUnusedReferenceDiagnosticsProvider({
    vscode: createFakeVscode([document]),
    workspaceStepIndex: {
      referenceCount(_sourceDocument, template) {
        return referenceCounts.get(template);
      },
    },
  });

  const diagnostics = await provider.provideDiagnostics(document);

  assert.deepEqual(diagnostics.map((diagnostic) => ({
    end: { ...diagnostic.range.end },
    start: { ...diagnostic.range.start },
  })), [
    // Heading marker through the last step of the block, stopping before the
    // next heading and excluding trailing blank lines.
    { start: { line: 3, character: 2 }, end: { line: 5, character: 12 } },
    { start: { line: 7, character: 0 }, end: { line: 9, character: 14 } },
  ]);
});

test("GaugeUnusedReferenceDiagnosticsProvider fades the whole unreferenced Step function block", async () => {
  const {
    GaugeUnusedReferenceDiagnosticsProvider,
  } = require("../src/unusedReferenceDiagnosticsProvider");
  const { WorkspaceStepIndex } = require("../src/workspaceStepIndex");
  const specDocument = createDocument([
    "# Checkout",
    "* Used Kotlin step",
    "* Used Java step",
  ].join("\n"), "/workspace/gauge/specs/checkout.spec", "gauge");
  const kotlinDocument = createDocument([
    "import com.thoughtworks.gauge.Step",
    "",
    "@Step(\"Used Kotlin step\")",
    "fun usedKotlinStep() {}",
    "",
    "@Step(\"Unused Kotlin step\")",
    "fun unusedKotlinStep() {",
    "    println(\"unused\")",
    "}",
    "",
    "@Step(\"Unused expression step\")",
    "fun unusedExpressionStep() = println(\"unused\")",
  ].join("\n"), "/workspace/gauge/src/test/kotlin/Steps.kt", "kotlin");
  const javaDocument = createDocument([
    "import com.thoughtworks.gauge.Step;",
    "",
    "class Steps {",
    "  @Step(\"Used Java step\")",
    "  void usedJavaStep() {}",
    "",
    "  @Step(\"Unused Java step\")",
    "  void unusedJavaStep() {",
    "    System.out.println(\"unused\");",
    "  }",
    "}",
  ].join("\n"), "/workspace/gauge/src/test/java/Steps.java", "java");
  const documents = [specDocument, kotlinDocument, javaDocument];
  const documentStore = {
    documents() {
      return documents;
    },
    onDidChangeDocuments() {
      return { dispose() {} };
    },
    start() {},
    whenReady() {
      return Promise.resolve();
    },
  };
  const projectFactory = {
    getGaugeRootFromFilePath() {
      return "/workspace/gauge";
    },
    isGaugeProject() {
      return true;
    },
  };
  const vscode = createFakeVscode(documents);
  const workspaceStepIndex = new WorkspaceStepIndex({
    documentStore,
    projectFactory,
    vscode,
  });
  const provider = new GaugeUnusedReferenceDiagnosticsProvider({
    documentStore,
    vscode,
    workspaceStepIndex,
  });

  const [kotlinDiagnostics, javaDiagnostics] = await Promise.all([
    provider.provideDiagnostics(kotlinDocument),
    provider.provideDiagnostics(javaDocument),
  ]);

  assert.deepEqual(kotlinDiagnostics.map((diagnostic) => ({
    end: { ...diagnostic.range.end },
    start: { ...diagnostic.range.start },
  })), [
    // Step annotation through the closing brace of the function body.
    { start: { line: 5, character: 0 }, end: { line: 8, character: 1 } },
    // Expression bodies end with the expression.
    { start: { line: 10, character: 0 }, end: { line: 11, character: 46 } },
  ]);
  assert.deepEqual(javaDiagnostics.map((diagnostic) => ({
    end: { ...diagnostic.range.end },
    start: { ...diagnostic.range.start },
  })), [
    { start: { line: 6, character: 2 }, end: { line: 9, character: 3 } },
  ]);
  workspaceStepIndex.dispose();
});
