const assert = require("node:assert/strict");
const test = require("node:test");

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function u1(value) {
  const buffer = Buffer.alloc(1);
  buffer.writeUInt8(value);
  return buffer;
}

function u2(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value);
  return buffer;
}

function u4(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

function utf8(value) {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([u1(1), u2(bytes.length), bytes]);
}

function classInfo(nameIndex) {
  return Buffer.concat([u1(7), u2(nameIndex)]);
}

function dependencyStepClass() {
  const constantPool = [
    utf8("steps/RequestSteps"),
    classInfo(1),
    utf8("java/lang/Object"),
    classInfo(3),
    utf8("send"),
    utf8("()V"),
    utf8("RuntimeVisibleAnnotations"),
    utf8("Lcom/thoughtworks/gauge/Step;"),
    utf8("value"),
    utf8("Send the <request>"),
    utf8("SourceFile"),
    utf8("RequestSteps.kt"),
  ];
  const stepAnnotation = Buffer.concat([
    u2(1),
    u2(8),
    u2(1),
    u2(9),
    u1("s".charCodeAt(0)),
    u2(10),
  ]);
  const method = Buffer.concat([
    u2(0x0001),
    u2(5),
    u2(6),
    u2(1),
    u2(7),
    u4(stepAnnotation.length),
    stepAnnotation,
  ]);
  const sourceFile = Buffer.concat([
    u2(11),
    u4(2),
    u2(12),
  ]);
  return Buffer.concat([
    Buffer.from([0xca, 0xfe, 0xba, 0xbe]),
    u2(0),
    u2(61),
    u2(constantPool.length + 1),
    ...constantPool,
    u2(0x0021),
    u2(2),
    u2(4),
    u2(0),
    u2(0),
    u2(1),
    method,
    u2(1),
    sourceFile,
  ]);
}

function createFakeVscode() {
  return {
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
    Uri: {
      parse(value) {
        const parsed = new URL(value);
        return {
          path: parsed.pathname,
          query: parsed.search.slice(1),
          scheme: parsed.protocol.slice(0, -1),
          toString() {
            return value;
          },
        };
      },
    },
  };
}

function createInFlightInvalidationFixture(options = {}) {
  const { DependencyStepIndex } = require("../src/dependencyStepIndex");
  const targetRoot = "/workspace/target";
  const otherRoot = "/workspace/other";
  const oldScanEntered = deferred();
  const releaseOldScan = deferred();
  const classpathCalls = new Map();
  const scans = [];
  let invalidationListener;
  const index = new DependencyStepIndex({
    async classpathProvider(root) {
      const call = (classpathCalls.get(root) || 0) + 1;
      classpathCalls.set(root, call);
      const name = root === targetRoot ? "target" : "other";
      const version = call === 1 ? "old" : "fresh";
      return [`/repo/${name}-${version}.jar`];
    },
    fileSystem: { existsSync: () => true },
    projectEnvironmentService: {
      onDidInvalidate(listener) {
        invalidationListener = listener;
        return { dispose() {} };
      },
    },
    async scanArchive(archivePath, visit) {
      scans.push(archivePath);
      if (archivePath === "/repo/target-old.jar") {
        oldScanEntered.resolve();
        await releaseOldScan.promise;
        if (options.oldScanError) {
          throw options.oldScanError;
        }
      }
      await visit("steps/RequestSteps.class", dependencyStepClass());
    },
    vscode: createFakeVscode(),
  });
  const registration = index.register();
  return {
    artifact(definitions) {
      assert.equal(definitions.length, 1);
      const match = index.content(definitions[0].uri).match(/Artifact: ([^\n]+)/);
      return match && match[1];
    },
    classpathCalls,
    index,
    invalidate(root) {
      invalidationListener(root);
    },
    oldScanEntered,
    otherRoot,
    registration,
    releaseOldScan,
    scans,
    targetRoot,
  };
}

test("parseDependencyClass indexes runtime Gauge Step annotations", () => {
  const { parseDependencyClass } = require("../src/dependencyStepIndex");

  const parsed = parseDependencyClass(dependencyStepClass(), "/repo/playtest-http.jar");

  assert.equal(parsed.className, "steps.RequestSteps");
  assert.equal(parsed.sourceFile, "RequestSteps.kt");
  assert.deepEqual(parsed.steps, [{
    aliases: ["Send the <request>"],
    descriptor: "()V",
    methodName: "send",
  }]);
});

test("DependencyStepIndex resolves indexed dependency methods to virtual declarations", async () => {
  const { DependencyStepIndex } = require("../src/dependencyStepIndex");
  const archiveScans = [];
  let classpathCalls = 0;
  const index = new DependencyStepIndex({
    async classpathProvider(projectRoot) {
      classpathCalls += 1;
      assert.equal(projectRoot, "/workspace/gauge");
      return ["/repo/playtest-http.jar"];
    },
    async scanArchive(archivePath, visit) {
      archiveScans.push(archivePath);
      await visit("steps/RequestSteps.class", dependencyStepClass());
    },
    fileSystem: { existsSync: () => true },
    vscode: createFakeVscode(),
  });

  await index.refresh("/workspace/gauge");
  const definitions = await index.findDefinitions("/workspace/gauge", ["Send the {}"]);

  assert.equal(classpathCalls, 1);
  assert.deepEqual(archiveScans, ["/repo/playtest-http.jar"]);
  assert.deepEqual([...index.stepTemplates("/workspace/gauge")], ["Send the {}"]);
  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].uri.scheme, "gauge-dependency");
  assert.match(index.content(definitions[0].uri), /@Step\("Send the <request>"\)/);
  assert.match(index.content(definitions[0].uri), /void send\(\);/);
  assert.deepEqual(
    { ...definitions[0].range.start },
    { line: 8, character: 7 },
  );
  assert.deepEqual(
    { ...definitions[0].range.end },
    { line: 8, character: 11 },
  );
});

// A classpath routinely holds jars this process cannot open: a truncated
// download, a permission-denied artifact, a native jar. scanJarArchive rejects on
// yauzl.open failure, and the per-archive await was unguarded, so one such jar
// threw away the whole index - every dependency step went undefined - and
// buildCurrentIndex kept rebuilding it.
test("DependencyStepIndex indexes the rest of the classpath past an unreadable jar", async () => {
  const { DependencyStepIndex } = require("../src/dependencyStepIndex");
  const archiveScans = [];
  const index = new DependencyStepIndex({
    async classpathProvider() {
      return ["/repo/broken.jar", "/repo/playtest-http.jar"];
    },
    async scanArchive(archivePath, visit) {
      archiveScans.push(archivePath);
      if (archivePath === "/repo/broken.jar") {
        throw new Error("end of central directory record signature not found");
      }
      await visit("steps/RequestSteps.class", dependencyStepClass());
    },
    fileSystem: { existsSync: () => true },
    vscode: createFakeVscode(),
  });

  await index.refresh("/workspace/gauge");

  assert.deepEqual(archiveScans, ["/repo/broken.jar", "/repo/playtest-http.jar"]);
  assert.deepEqual([...index.stepTemplates("/workspace/gauge")], ["Send the {}"]);
});

test("DependencyStepIndex gets classpath from the asynchronous environment service", async () => {
  const { DependencyStepIndex } = require("../src/dependencyStepIndex");
  const project = {
    root() {
      return "/workspace/gauge";
    },
  };
  const calls = [];
  const index = new DependencyStepIndex({
    fileSystem: {
      existsSync(file) {
        return file === "/workspace/dependency.jar";
      },
    },
    pathModule: require("node:path").posix,
    projectEnvironmentService: {
      async environmentFor(candidate) {
        calls.push(candidate);
        return { gauge_custom_classpath: "/workspace/dependency.jar" };
      },
    },
    projectFactory: {
      get() {
        return project;
      },
    },
    async scanArchive() {},
    vscode: {},
  });

  await index.refresh("/workspace/gauge");

  assert.deepEqual(calls, [project]);
});

test("DependencyStepIndex preserves root invalidation received during an in-flight refresh", async () => {
  const fixture = createInFlightInvalidationFixture();
  const operations = [];
  try {
    await fixture.index.findDefinitions(fixture.otherRoot, ["Send the {}"]);
    const otherIndex = fixture.index.indices.get(fixture.otherRoot);
    const first = fixture.index.findDefinitions(fixture.targetRoot, ["Send the {}"]);
    operations.push(first);
    await fixture.oldScanEntered.promise;

    fixture.invalidate(fixture.targetRoot);
    const follower = fixture.index.findDefinitions(fixture.targetRoot, ["Send the {}"]);
    operations.push(follower);
    await Promise.resolve();
    const targetCallsBeforeRelease = fixture.classpathCalls.get(fixture.targetRoot);

    fixture.releaseOldScan.resolve();
    const [firstDefinitions, followerDefinitions] = await Promise.all([first, follower]);
    const laterDefinitions = await fixture.index.findDefinitions(
      fixture.targetRoot,
      ["Send the {}"],
    );
    const otherDefinitions = await fixture.index.findDefinitions(
      fixture.otherRoot,
      ["Send the {}"],
    );

    assert.deepEqual({
      artifacts: [firstDefinitions, followerDefinitions, laterDefinitions].map(fixture.artifact),
      otherArtifact: fixture.artifact(otherDefinitions),
      otherCalls: fixture.classpathCalls.get(fixture.otherRoot),
      otherIdentityRetained: fixture.index.indices.get(fixture.otherRoot) === otherIndex,
      pending: fixture.index.pending.size,
      scans: fixture.scans,
      targetCalls: fixture.classpathCalls.get(fixture.targetRoot),
      targetCallsBeforeRelease,
    }, {
      artifacts: [
        "/repo/target-fresh.jar",
        "/repo/target-fresh.jar",
        "/repo/target-fresh.jar",
      ],
      otherArtifact: "/repo/other-old.jar",
      otherCalls: 1,
      otherIdentityRetained: true,
      pending: 0,
      scans: [
        "/repo/other-old.jar",
        "/repo/target-old.jar",
        "/repo/target-fresh.jar",
      ],
      targetCalls: 2,
      targetCallsBeforeRelease: 1,
    });
  } finally {
    fixture.releaseOldScan.resolve();
    await Promise.allSettled(operations);
    fixture.registration.dispose();
  }
});

test("DependencyStepIndex preserves global invalidation received during an in-flight refresh", async () => {
  const fixture = createInFlightInvalidationFixture({
    oldScanError: new Error("stale dependency scan failed"),
  });
  const operations = [];
  try {
    const firstOtherDefinitions = await fixture.index.findDefinitions(
      fixture.otherRoot,
      ["Send the {}"],
    );
    const first = fixture.index.findDefinitions(fixture.targetRoot, ["Send the {}"]);
    operations.push(first);
    await fixture.oldScanEntered.promise;

    fixture.invalidate(undefined);
    const follower = fixture.index.findDefinitions(fixture.targetRoot, ["Send the {}"]);
    const refreshedOther = fixture.index.findDefinitions(fixture.otherRoot, ["Send the {}"]);
    operations.push(follower, refreshedOther);
    await Promise.resolve();
    const targetCallsBeforeRelease = fixture.classpathCalls.get(fixture.targetRoot);

    fixture.releaseOldScan.resolve();
    const [firstDefinitions, followerDefinitions, otherDefinitions] = await Promise.all([
      first,
      follower,
      refreshedOther,
    ]);
    const laterDefinitions = await fixture.index.findDefinitions(
      fixture.targetRoot,
      ["Send the {}"],
    );

    assert.deepEqual({
      firstOtherArtifact: fixture.artifact(firstOtherDefinitions),
      otherArtifact: fixture.artifact(otherDefinitions),
      otherCalls: fixture.classpathCalls.get(fixture.otherRoot),
      pending: fixture.index.pending.size,
      scans: [...fixture.scans].sort(),
      targetArtifacts: [firstDefinitions, followerDefinitions, laterDefinitions]
        .map(fixture.artifact),
      targetCalls: fixture.classpathCalls.get(fixture.targetRoot),
      targetCallsBeforeRelease,
    }, {
      firstOtherArtifact: "/repo/other-old.jar",
      otherArtifact: "/repo/other-fresh.jar",
      otherCalls: 2,
      pending: 0,
      scans: [
        "/repo/other-old.jar",
        "/repo/other-fresh.jar",
        "/repo/target-fresh.jar",
        "/repo/target-old.jar",
      ].sort(),
      targetArtifacts: [
        "/repo/target-fresh.jar",
        "/repo/target-fresh.jar",
        "/repo/target-fresh.jar",
      ],
      targetCalls: 2,
      targetCallsBeforeRelease: 1,
    });
  } finally {
    fixture.releaseOldScan.resolve();
    await Promise.allSettled(operations);
    fixture.registration.dispose();
  }
});

test("DependencyStepIndex rejects cached and resolved indices invalidated before publication", async () => {
  const { DependencyStepIndex } = require("../src/dependencyStepIndex");
  const root = "/workspace/gauge";
  const archives = ["old", "fresh", "latest"];
  const scans = [];
  let classpathCalls = 0;
  const index = new DependencyStepIndex({
    async classpathProvider() {
      const archive = archives[Math.min(classpathCalls, archives.length - 1)];
      classpathCalls += 1;
      return [`/repo/${archive}.jar`];
    },
    fileSystem: { existsSync: () => true },
    async scanArchive(archivePath, visit) {
      scans.push(archivePath);
      await visit("steps/RequestSteps.class", dependencyStepClass());
    },
    vscode: createFakeVscode(),
  });

  const oldIndex = await index.refresh(root);
  const cachedRefresh = index.refresh(root);
  index.invalidate(root);
  const freshIndex = await cachedRefresh;

  const originalRefresh = index.refresh.bind(index);
  index.refresh = () => ({
    then(resolve) {
      index.refresh = originalRefresh;
      resolve(freshIndex);
      index.invalidate(root);
    },
  });
  const definitions = await index.findDefinitions(root, ["Send the {}"]);
  const artifact = index.content(definitions[0].uri).match(/Artifact: ([^\n]+)/)[1];

  assert.deepEqual({
    artifact,
    classpathCalls,
    contents: index.contents.size,
    freshClasspath: freshIndex.classpathKey,
    oldClasspath: oldIndex.classpathKey,
    pending: index.pending.size,
    scans,
  }, {
    artifact: "/repo/latest.jar",
    classpathCalls: 3,
    contents: 2,
    freshClasspath: "/repo/fresh.jar",
    oldClasspath: "/repo/old.jar",
    pending: 0,
    scans: ["/repo/old.jar", "/repo/fresh.jar", "/repo/latest.jar"],
  });
});

test("DependencyStepIndex retries synchronous invalidation during definition publication", async () => {
  const { DependencyStepIndex } = require("../src/dependencyStepIndex");
  const root = "/workspace/gauge";
  const archives = ["old", "fresh"];
  const scans = [];
  let classpathCalls = 0;
  const index = new DependencyStepIndex({
    async classpathProvider() {
      const archive = archives[Math.min(classpathCalls, archives.length - 1)];
      classpathCalls += 1;
      return [`/repo/${archive}.jar`];
    },
    fileSystem: { existsSync: () => true },
    async scanArchive(archivePath, visit) {
      scans.push(archivePath);
      await visit("steps/RequestSteps.class", dependencyStepClass());
    },
    vscode: createFakeVscode(),
  });

  const originalUriFor = index.uriFor.bind(index);
  let oldUri;
  index.uriFor = (entry, projectRoot) => {
    const uri = originalUriFor(entry, projectRoot);
    if (!oldUri) {
      oldUri = uri;
      index.invalidate(root);
    }
    return uri;
  };

  const definitions = await index.findDefinitions(root, ["Send the {}"]);
  const artifact = index.content(definitions[0].uri).match(/Artifact: ([^\n]+)/)[1];

  assert.deepEqual({
    artifact,
    classpathCalls,
    contents: index.contents.size,
    generation: index.generation,
    oldContent: index.content(oldUri),
    pending: index.pending.size,
    scans,
  }, {
    artifact: "/repo/fresh.jar",
    classpathCalls: 2,
    contents: 2,
    generation: 3,
    oldContent: "Dependency step declaration is unavailable.",
    pending: 0,
    scans: ["/repo/old.jar", "/repo/fresh.jar"],
  });
});

test("DependencyStepIndex returns no definitions after disposal during a scan", async () => {
  const { DependencyStepIndex } = require("../src/dependencyStepIndex");
  const scanEntered = deferred();
  const releaseScan = deferred();
  const registrationDisposals = { content: 0, invalidation: 0 };
  let classpathCalls = 0;
  let contentProvider;
  let scanCalls = 0;
  const vscode = {
    ...createFakeVscode(),
    workspace: {
      registerTextDocumentContentProvider(scheme, provider) {
        assert.equal(scheme, "gauge-dependency");
        contentProvider = provider;
        return {
          dispose() {
            registrationDisposals.content += 1;
          },
        };
      },
    },
  };
  const index = new DependencyStepIndex({
    async classpathProvider() {
      classpathCalls += 1;
      return ["/repo/playtest-http.jar"];
    },
    fileSystem: { existsSync: () => true },
    projectEnvironmentService: {
      onDidInvalidate() {
        return {
          dispose() {
            registrationDisposals.invalidation += 1;
          },
        };
      },
    },
    async scanArchive(_archivePath, visit) {
      scanCalls += 1;
      scanEntered.resolve();
      await releaseScan.promise;
      await visit("steps/RequestSteps.class", dependencyStepClass());
    },
    vscode,
  });
  const registration = index.register();

  const pending = index.findDefinitions("/workspace/gauge", ["Send the {}"]);
  await scanEntered.promise;
  registration.dispose();
  registration.dispose();
  assert.equal(index.pending.size, 0);
  const later = index.findDefinitions("/workspace/gauge", ["Send the {}"]);
  releaseScan.resolve();

  const [pendingDefinitions, laterDefinitions] = await Promise.all([pending, later]);
  const afterDefinitions = await index.findDefinitions(
    "/workspace/gauge",
    ["Send the {}"],
  );
  const missingUri = {
    query: "missing",
    toString() {
      return "gauge-dependency:/missing";
    },
  };

  assert.deepEqual({
    afterDefinitions,
    classpathCalls,
    content: contentProvider.provideTextDocumentContent(missingUri),
    contents: index.contents.size,
    indices: index.indices.size,
    laterDefinitions,
    pending: index.pending.size,
    pendingDefinitions,
    registrationDisposals,
    scanCalls,
    templates: [...index.stepTemplates("/workspace/gauge")],
  }, {
    afterDefinitions: [],
    classpathCalls: 1,
    content: "Dependency step declaration is unavailable.",
    contents: 0,
    indices: 0,
    laterDefinitions: [],
    pending: 0,
    pendingDefinitions: [],
    registrationDisposals: { content: 1, invalidation: 1 },
    scanCalls: 1,
    templates: [],
  });
});

test("DependencyStepIndex suppresses scan failures after disposal", async () => {
  const { DependencyStepIndex } = require("../src/dependencyStepIndex");
  const scanEntered = deferred();
  const releaseScan = deferred();
  const index = new DependencyStepIndex({
    classpathProvider: async () => ["/repo/playtest-http.jar"],
    fileSystem: { existsSync: () => true },
    async scanArchive() {
      scanEntered.resolve();
      await releaseScan.promise;
      throw new Error("disposed dependency scan failed");
    },
    vscode: createFakeVscode(),
  });
  const registration = index.register();

  const pendingRefresh = index.refresh("/workspace/gauge");
  await scanEntered.promise;
  const pending = index.findDefinitions("/workspace/gauge", ["Send the {}"]);
  registration.dispose();
  releaseScan.resolve();

  assert.equal(await pendingRefresh, undefined);
  assert.deepEqual(await pending, []);
  assert.equal(index.indices.size, 0);
  assert.equal(index.pending.size, 0);

  // A live failure still surfaces. The vehicle is classpath resolution rather
  // than a single archive: an unreadable jar is skipped on purpose so it cannot
  // throw away every other dependency's steps.
  const liveIndex = new DependencyStepIndex({
    classpathProvider: async () => {
      throw new Error("live dependency scan failed");
    },
    fileSystem: { existsSync: () => true },
    async scanArchive() {},
    vscode: createFakeVscode(),
  });
  await assert.rejects(
    liveIndex.findDefinitions("/workspace/gauge", ["Send the {}"]),
    /live dependency scan failed/,
  );
});

test("DependencyStepIndex clears warmed declarations when disposed", async () => {
  const { DependencyStepIndex } = require("../src/dependencyStepIndex");
  let classpathCalls = 0;
  let scanCalls = 0;
  const index = new DependencyStepIndex({
    async classpathProvider() {
      classpathCalls += 1;
      return ["/repo/playtest-http.jar"];
    },
    fileSystem: { existsSync: () => true },
    async scanArchive(_archivePath, visit) {
      scanCalls += 1;
      await visit("steps/RequestSteps.class", dependencyStepClass());
    },
    vscode: createFakeVscode(),
  });
  const registration = index.register();
  const definitions = await index.findDefinitions(
    "/workspace/gauge",
    ["Send the {}"],
  );
  const definitionUri = definitions[0].uri;

  assert.equal(index.indices.size, 1);
  assert.equal(index.contents.size, 2);
  assert.deepEqual([...index.stepTemplates("/workspace/gauge")], ["Send the {}"]);
  assert.match(index.content(definitionUri), /void send\(\);/);
  const generationBeforeDisposal = index.generation;
  const pendingCachedRefresh = index.refresh("/workspace/gauge");

  registration.dispose();
  index.dispose();
  const cachedRefresh = await pendingCachedRefresh;
  const laterDefinitions = await index.findDefinitions(
    "/workspace/gauge",
    ["Send the {}"],
  );

  assert.deepEqual({
    classpathCalls,
    content: index.content(definitionUri),
    contents: index.contents.size,
    generation: index.generation,
    indices: index.indices.size,
    laterDefinitions,
    pending: index.pending.size,
    cachedRefresh,
    scanCalls,
    templates: [...index.stepTemplates("/workspace/gauge")],
  }, {
    classpathCalls: 1,
    content: "Dependency step declaration is unavailable.",
    contents: 0,
    generation: generationBeforeDisposal + 1,
    indices: 0,
    laterDefinitions: [],
    pending: 0,
    cachedRefresh: undefined,
    scanCalls: 1,
    templates: [],
  });
});

test("DependencyStepIndex does not scan after disposal during classpath lookup", async () => {
  const { DependencyStepIndex } = require("../src/dependencyStepIndex");
  const classpathEntered = deferred();
  const releaseClasspath = deferred();
  let classpathCalls = 0;
  let scanCalls = 0;
  const index = new DependencyStepIndex({
    async classpathProvider() {
      classpathCalls += 1;
      classpathEntered.resolve();
      return releaseClasspath.promise;
    },
    fileSystem: { existsSync: () => true },
    async scanArchive() {
      scanCalls += 1;
    },
    vscode: createFakeVscode(),
  });
  const registration = index.register();

  const pendingRefresh = index.refresh("/workspace/gauge");
  await classpathEntered.promise;
  registration.dispose();
  assert.equal(index.pending.size, 0);
  assert.equal(await index.refresh("/workspace/gauge", true), undefined);
  releaseClasspath.resolve(["/repo/playtest-http.jar"]);

  assert.equal(await pendingRefresh, undefined);
  assert.deepEqual({
    classpathCalls,
    indices: index.indices.size,
    pending: index.pending.size,
    scanCalls,
  }, {
    classpathCalls: 1,
    indices: 0,
    pending: 0,
    scanCalls: 0,
  });
});
