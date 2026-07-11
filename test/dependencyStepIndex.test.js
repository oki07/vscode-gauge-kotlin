const assert = require("node:assert/strict");
const test = require("node:test");

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
