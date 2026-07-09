const assert = require("node:assert/strict");
const test = require("node:test");

class CapturingSemanticTokensBuilder {
  constructor() {
    this.tokens = [];
  }

  push(line, start, length, tokenType, tokenModifiers) {
    this.tokens.push({ line, start, length, tokenType, tokenModifiers });
  }

  build() {
    return this.tokens;
  }
}

test("GaugeSemanticTokensProvider tokenizes Gauge document elements", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const document = {
    getText() {
      return [
        "* Say \"hello\" to <name>",
        "table: users.csv",
        "| name |",
        "| ---- | ---- |",
        "tags: smoke, fast",
        "// * disabled step",
        "plain comment",
      ].join("\n");
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document);
  const namedTokens = tokens.map((entry) => ({
    ...entry,
    type: tokenTypes[entry.tokenType],
  }));

  assert.deepEqual(namedTokens.filter((entry) => entry.line === 0).map((entry) => entry.type), [
    "stepMarker",
    "step",
    "argument",
    "step",
    "dynamicArgument",
  ]);
  assert.deepEqual(namedTokens.filter((entry) => entry.line === 1).map((entry) => entry.type), [
    "tableKeyword",
    "tableFileValue",
  ]);
  assert.equal(namedTokens.some((entry) => entry.line === 2 && entry.type === "tableBorder"), true);
  assert.equal(namedTokens.some((entry) => entry.line === 3 && entry.type === "tableHeaderSeparator"), true);
  assert.deepEqual(namedTokens.filter((entry) => entry.line === 4).map((entry) => entry.type), [
    "tagKeyword",
    "tagValue",
  ]);
  assert.deepEqual(namedTokens.filter((entry) => entry.line === 5).map((entry) => entry.type), [
    "disabledStep",
  ]);
  assert.deepEqual(namedTokens.filter((entry) => entry.line === 6).map((entry) => entry.type), [
    "gaugeComment",
  ]);
});

test("GaugeSemanticTokensProvider tokenizes keyword lines with space before colon", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const document = {
    getText() {
      return [
        "table : users.csv",
        "tags : smoke, fast",
      ].join("\n");
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));

  assert.deepEqual(tokens.filter((entry) => entry.line === 0).map((entry) => entry.type), [
    "tableKeyword",
    "tableFileValue",
  ]);
  assert.deepEqual(tokens.filter((entry) => entry.line === 1).map((entry) => entry.type), [
    "tagKeyword",
    "tagValue",
  ]);
});

test("GaugeSemanticTokensProvider tokenizes multiline tag continuations", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const document = {
    uri: { fsPath: "/workspace/specs/example.spec" },
    getText() {
      return [
        "tags: smoke,",
        "fast,",
        "regression",
        "* Run tagged scenario",
      ].join("\n");
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));

  assert.deepEqual(tokens.filter((entry) => entry.line === 0).map((entry) => entry.type), [
    "tagKeyword",
    "tagValue",
  ]);
  assert.deepEqual(tokens.filter((entry) => entry.line === 1).map((entry) => entry.type), [
    "tagValue",
  ]);
  assert.deepEqual(tokens.filter((entry) => entry.line === 2).map((entry) => entry.type), [
    "tagValue",
  ]);
  assert.equal(tokens.some((entry) => entry.line === 3 && entry.type === "tagValue"), false);
});

test("GaugeSemanticTokensProvider stops tag continuations before table keyword lines", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const document = {
    uri: { fsPath: "/workspace/specs/example.spec" },
    getText() {
      return [
        "tags: smoke,",
        "table: users.csv",
      ].join("\n");
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));

  assert.deepEqual(tokens.filter((entry) => entry.line === 0).map((entry) => entry.type), [
    "tagKeyword",
    "tagValue",
  ]);
  assert.deepEqual(tokens.filter((entry) => entry.line === 1).map((entry) => entry.type), [
    "tableKeyword",
    "tableFileValue",
  ]);
  assert.equal(tokens.some((entry) => entry.line === 1 && entry.type === "tagValue"), false);
});

test("GaugeSemanticTokensProvider stops tag continuations before Gauge syntax starts", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const cases = [
    {
      line: "tags: fast",
      expected: ["tagKeyword", "tagValue"],
    },
    {
      line: "___",
      expected: ["teardownIdentifier"],
    },
    {
      line: "| name |",
      expectedIncludes: ["tableBorder", "tableHeader"],
    },
    {
      line: "// disabled",
      expected: ["disabledStep"],
    },
  ];

  for (const entry of cases) {
    const document = {
      uri: { fsPath: "/workspace/specs/example.spec" },
      getText() {
        return [
          "tags: smoke,",
          entry.line,
        ].join("\n");
      },
    };
    const tokens = provider.provideDocumentSemanticTokens(document)
      .map((token) => ({ ...token, type: tokenTypes[token.tokenType] }));
    const lineTypes = tokens.filter((token) => token.line === 1).map((token) => token.type);

    if (entry.expected) {
      assert.deepEqual(lineTypes, entry.expected);
    } else {
      for (const expectedType of entry.expectedIncludes) {
        assert.equal(lineTypes.includes(expectedType), true);
      }
    }
    assert.equal(lineTypes.includes("tagValue"), Boolean(entry.expected && entry.expected.includes("tagValue")));
  }
});

test("GaugeSemanticTokensProvider stops tag continuations before legacy underline headings", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const cases = [
    {
      heading: "Checkout flow",
      underline: "=============",
      expectedType: "specification",
    },
    {
      heading: "Successful checkout",
      underline: "-------------------",
      expectedType: "scenario",
    },
  ];

  for (const entry of cases) {
    const document = {
      uri: { fsPath: "/workspace/specs/example.spec" },
      getText() {
        return [
          "tags: smoke,",
          entry.heading,
          entry.underline,
        ].join("\n");
      },
    };
    const tokens = provider.provideDocumentSemanticTokens(document)
      .map((token) => ({ ...token, type: tokenTypes[token.tokenType] }));
    const headingTypes = tokens.filter((token) => token.line === 1).map((token) => token.type);
    const underlineTypes = tokens.filter((token) => token.line === 2).map((token) => token.type);

    assert.deepEqual(headingTypes, [entry.expectedType]);
    assert.deepEqual(underlineTypes, [entry.expectedType]);
    assert.equal(headingTypes.includes("tagValue"), false);
  }
});

test("GaugeSemanticTokensProvider tokenizes teardown separators", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const document = {
    uri: { fsPath: "/workspace/specs/example.spec" },
    getText() {
      return [
        "___",
        "___  ",
      ].join("\n");
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));

  assert.equal(tokenTypes.includes("teardownIdentifier"), true);
  assert.deepEqual(tokens.map((entry) => entry.type), [
    "teardownIdentifier",
    "teardownIdentifier",
  ]);
});

test("GaugeSemanticTokensProvider treats concept keyword-like lines as comments", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const document = {
    uri: { fsPath: "/workspace/specs/concepts/shared.cpt" },
    getText() {
      return [
        "table: users.csv",
        "tags: smoke, fast",
      ].join("\n");
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));

  assert.deepEqual(tokens.map((entry) => entry.type), [
    "gaugeComment",
    "gaugeComment",
  ]);
});

test("GaugeSemanticTokensProvider distinguishes specification scenario and concept headings", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const specDocument = {
    uri: { fsPath: "/workspace/specs/example.spec" },
    getText() {
      return [
        "# Specification <name>",
        "## Scenario \"name\"",
      ].join("\n");
    },
  };
  const conceptDocument = {
    uri: { fsPath: "/workspace/specs/concepts/shared.cpt" },
    getText() {
      return "# Shared checkout <item> now";
    },
  };

  const specTokens = provider.provideDocumentSemanticTokens(specDocument)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));
  assert.deepEqual(specTokens.filter((entry) => entry.line === 0).map((entry) => entry.type), [
    "specification",
    "dynamicArgument",
  ]);
  assert.deepEqual(specTokens.filter((entry) => entry.line === 1).map((entry) => entry.type), [
    "scenario",
    "argument",
  ]);

  const conceptTokens = provider.provideDocumentSemanticTokens(conceptDocument)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));
  assert.deepEqual(conceptTokens.map((entry) => entry.type), [
    "specification",
    "dynamicArgument",
    "specification",
  ]);
});

test("GaugeSemanticTokensProvider treats triple-hash headings as comments", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const document = {
    uri: { fsPath: "/workspace/specs/example.spec" },
    getText() {
      return [
        "# Specification",
        "### Notes",
      ].join("\n");
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));

  assert.deepEqual(tokens.map((entry) => [entry.line, entry.type]), [
    [0, "specification"],
    [1, "gaugeComment"],
  ]);
});

test("GaugeSemanticTokensProvider treats double-star lines as comments", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const document = {
    uri: { fsPath: "/workspace/specs/example.spec" },
    getText() {
      return "** Bold comment";
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));

  assert.deepEqual(tokens.map((entry) => [entry.line, entry.type]), [
    [0, "gaugeComment"],
  ]);
});

test("GaugeSemanticTokensProvider ignores Markdown outside Gauge projects", () => {
  const { GaugeSemanticTokensProvider } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/readme.md");
        throw new Error("not a Gauge project file");
      },
    },
  });
  const document = {
    languageId: "markdown",
    uri: { fsPath: "/workspace/readme.md" },
    getText() {
      return [
        "# Notes",
        "* List item",
      ].join("\n");
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document);

  assert.deepEqual(tokens, []);
});

test("GaugeSemanticTokensProvider ignores Markdown when the resolved root is not a Gauge project", () => {
  const { GaugeSemanticTokensProvider } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/notes/readme.md");
        return "/workspace/notes";
      },
      isGaugeProject(root) {
        assert.equal(root, "/workspace/notes");
        return false;
      },
    },
  });
  const document = {
    languageId: "markdown",
    uri: { fsPath: "/workspace/notes/readme.md" },
    getText() {
      return [
        "# Notes",
        "* List item",
      ].join("\n");
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document);

  assert.deepEqual(tokens, []);
});

test("GaugeSemanticTokensProvider ignores Gauge files by extension outside Gauge projects", () => {
  const { GaugeSemanticTokensProvider } = require("../src/semanticTokensProvider");
  const checkedFiles = [];
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        checkedFiles.push(filename);
        return filename.includes("/concepts/") ? "/workspace/concepts" : "/workspace/specs";
      },
      isGaugeProject(root) {
        assert.equal(root === "/workspace/specs" || root === "/workspace/concepts", true);
        return false;
      },
    },
  });
  const specDocument = {
    languageId: "plaintext",
    uri: { fsPath: "/workspace/specs/example.spec" },
    getText() {
      return [
        "# Checkout",
        "* Pay",
      ].join("\n");
    },
  };
  const conceptDocument = {
    languageId: "plaintext",
    uri: { fsPath: "/workspace/concepts/shared.cpt" },
    getText() {
      return [
        "# Shared checkout",
        "* Reuse cart",
      ].join("\n");
    },
  };

  assert.deepEqual(provider.provideDocumentSemanticTokens(specDocument), []);
  assert.deepEqual(provider.provideDocumentSemanticTokens(conceptDocument), []);
  assert.deepEqual(checkedFiles, [
    "/workspace/specs/example.spec",
    "/workspace/concepts/shared.cpt",
  ]);
});

test("GaugeSemanticTokensProvider ignores Gauge files when project root is unresolved", () => {
  const { GaugeSemanticTokensProvider } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
    projectFactory: {
      getGaugeRootFromFilePath(filename) {
        assert.equal(filename, "/workspace/notes/example.spec");
        return undefined;
      },
    },
  });
  const document = {
    languageId: "plaintext",
    uri: { fsPath: "/workspace/notes/example.spec" },
    getText() {
      return [
        "# Notes",
        "* Draft",
      ].join("\n");
    },
  };

  assert.deepEqual(provider.provideDocumentSemanticTokens(document), []);
});

test("GaugeSemanticTokensProvider keeps quoted concept heading text plain", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const document = {
    uri: { fsPath: "/workspace/specs/concepts/shared.cpt" },
    getText() {
      return '# Shared "cart" only';
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));

  assert.deepEqual(tokens.map((entry) => entry.type), [
    "specification",
  ]);
  assert.deepEqual({ line: tokens[0].line, start: tokens[0].start, length: tokens[0].length }, {
    line: 0,
    start: 0,
    length: 20,
  });
});

test("GaugeSemanticTokensProvider treats concept double-hash headings as concept headings", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const document = {
    uri: { fsPath: "/workspace/specs/concepts/shared.cpt" },
    getText() {
      return "## Shared checkout <item>";
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));

  assert.deepEqual(tokens.map((entry) => entry.type), [
    "specification",
    "dynamicArgument",
  ]);
});

test("GaugeSemanticTokensProvider treats indented concept hash headings as comments", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const document = {
    uri: { fsPath: "/workspace/specs/concepts/shared.cpt" },
    getText() {
      return [
        "  # Shared checkout <item>",
        "* Select <item>",
      ].join("\n");
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));

  assert.deepEqual(tokens.filter((entry) => entry.line === 0).map((entry) => entry.type), [
    "gaugeComment",
  ]);
});

test("GaugeSemanticTokensProvider tokenizes indented step markers", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const specDocument = {
    uri: { fsPath: "/workspace/specs/example.spec" },
    getText() {
      return [
        "  * Commented setup \"draft\" <ignored>",
        "* Real <item>",
      ].join("\n");
    },
  };
  const conceptDocument = {
    uri: { fsPath: "/workspace/specs/concepts/shared.cpt" },
    getText() {
      return [
        "  * Commented setup \"draft\" <ignored>",
        "* Real <item>",
      ].join("\n");
    },
  };

  const specTokens = provider.provideDocumentSemanticTokens(specDocument)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));
  const conceptTokens = provider.provideDocumentSemanticTokens(conceptDocument)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));

  assert.deepEqual(specTokens.filter((entry) => entry.line === 0).map((entry) => entry.type), [
    "stepMarker",
    "step",
    "argument",
    "step",
    "dynamicArgument",
  ]);
  assert.deepEqual(conceptTokens.filter((entry) => entry.line === 0).map((entry) => entry.type), [
    "stepMarker",
    "step",
    "argument",
    "step",
    "dynamicArgument",
  ]);
  assert.deepEqual(specTokens.filter((entry) => entry.line === 1).map((entry) => entry.type), [
    "stepMarker",
    "step",
    "dynamicArgument",
  ]);
  assert.deepEqual(conceptTokens.filter((entry) => entry.line === 1).map((entry) => entry.type), [
    "stepMarker",
    "step",
    "dynamicArgument",
  ]);
});

test("GaugeSemanticTokensProvider ignores concept hyphen underline headings", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const document = {
    uri: { fsPath: "/workspace/specs/concepts/shared.cpt" },
    getText() {
      return [
        "Not a concept heading",
        "---------------------",
        "* Reuse",
      ].join("\n");
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));

  assert.deepEqual(tokens.filter((entry) => entry.line < 2).map((entry) => entry.type), [
    "gaugeComment",
    "gaugeComment",
  ]);
});

test("GaugeSemanticTokensProvider ignores concept equals underline after identifiers", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const document = {
    uri: { fsPath: "/workspace/specs/concepts/shared.cpt" },
    getText() {
      return [
        "* Reuse",
        "=======",
        "| name |",
        "=======",
      ].join("\n");
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));

  assert.deepEqual(tokens.filter((entry) => entry.line === 0).map((entry) => entry.type), [
    "stepMarker",
    "step",
  ]);
  assert.deepEqual(tokens.filter((entry) => entry.line === 1).map((entry) => entry.type), [
    "gaugeComment",
  ]);
  assert.equal(tokens.some((entry) => entry.line === 2 && entry.type === "tableBorder"), true);
  assert.deepEqual(tokens.filter((entry) => entry.line === 3).map((entry) => entry.type), [
    "gaugeComment",
  ]);
});

test("GaugeSemanticTokensProvider ignores indented legacy underline headings", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const specDocument = {
    uri: { fsPath: "/workspace/specs/example.spec" },
    getText() {
      return [
        "Checkout",
        "  ========",
        "* Open cart",
      ].join("\n");
    },
  };
  const conceptDocument = {
    uri: { fsPath: "/workspace/specs/concepts/shared.cpt" },
    getText() {
      return [
        "Shared checkout",
        "  ========",
        "* Reuse",
      ].join("\n");
    },
  };

  const specTokens = provider.provideDocumentSemanticTokens(specDocument)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));
  const conceptTokens = provider.provideDocumentSemanticTokens(conceptDocument)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));

  assert.deepEqual(specTokens.filter((entry) => entry.line < 2).map((entry) => entry.type), [
    "gaugeComment",
    "gaugeComment",
  ]);
  assert.deepEqual(specTokens.filter((entry) => entry.line === 2).map((entry) => entry.type), [
    "stepMarker",
    "step",
  ]);
  assert.deepEqual(conceptTokens.filter((entry) => entry.line < 2).map((entry) => entry.type), [
    "gaugeComment",
    "gaugeComment",
  ]);
  assert.deepEqual(conceptTokens.filter((entry) => entry.line === 2).map((entry) => entry.type), [
    "stepMarker",
    "step",
  ]);
});

test("GaugeSemanticTokensProvider requires concept legacy underline terminators", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const specDocument = {
    uri: { fsPath: "/workspace/specs/example.spec" },
    getText() {
      return [
        "Checkout",
        "========",
      ].join("\n");
    },
  };
  const conceptDocument = {
    uri: { fsPath: "/workspace/specs/concepts/shared.cpt" },
    getText() {
      return [
        "Shared checkout",
        "========",
      ].join("\n");
    },
  };

  const specTokens = provider.provideDocumentSemanticTokens(specDocument)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));
  const conceptTokens = provider.provideDocumentSemanticTokens(conceptDocument)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));

  assert.deepEqual(specTokens.map((entry) => entry.type), [
    "specification",
    "specification",
  ]);
  assert.deepEqual(conceptTokens.map((entry) => entry.type), [
    "gaugeComment",
    "gaugeComment",
  ]);
});

test("GaugeSemanticTokensProvider tokenizes dynamic table cell arguments", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const document = {
    getText() {
      return [
        "| name | role |",
        "| ---- | ---- |",
        "| <user> | admin |",
      ].join("\n");
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));
  const argumentTokens = tokens.filter((entry) => entry.line === 2 && entry.type === "dynamicArgument");

  assert.deepEqual(argumentTokens, [
    {
      line: 2,
      start: 2,
      length: 6,
      tokenType: tokenTypes.indexOf("dynamicArgument"),
      tokenModifiers: 0,
      type: "dynamicArgument",
    },
  ]);
});

test("GaugeSemanticTokensProvider tokenizes table headers as tableHeader tokens", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const document = {
    getText() {
      return [
        "| <user> | role |",
        "| ------ | ---- |",
        "| Bob    | admin |",
      ].join("\n");
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));

  const headerTokens = tokens
    .filter((entry) => entry.line === 0 && entry.type === "tableHeader")
    .map(({ start, length }) => ({ start, length }));

  assert.deepEqual(tokens.filter((entry) => entry.line === 0 && entry.type === "argument"), []);
  assert.deepEqual(tokens.filter((entry) => entry.line === 0 && entry.type === "table"), []);
  assert.deepEqual(
    tokens.filter((entry) => entry.line === 0 && entry.type === "tableBorder").map((entry) => entry.start),
    [0, 9, 16],
  );
  assert.deepEqual(headerTokens, [
    { start: 1, length: 8 },
    { start: 10, length: 6 },
  ]);
});

test("GaugeSemanticTokensProvider tokenizes first table rows as headers without separators", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const document = {
    getText() {
      return [
        "| <user> | role |",
        "| Ada    | admin |",
      ].join("\n");
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));

  assert.deepEqual(tokens.filter((entry) => entry.line === 0 && entry.type === "argument"), []);
  assert.deepEqual(tokens.filter((entry) => entry.line === 0 && entry.type === "table"), []);
  assert.deepEqual(
    tokens.filter((entry) => entry.line === 0 && entry.type === "tableBorder").map((entry) => entry.start),
    [0, 9, 16],
  );
  assert.deepEqual(
    tokens.filter((entry) => entry.line === 0 && entry.type === "tableHeader")
      .map(({ start, length }) => ({ start, length })),
    [
      { start: 1, length: 8 },
      { start: 10, length: 6 },
    ],
  );
  assert.equal(tokens.some((entry) => entry.line === 1 && entry.type === "tableHeader"), false);
  assert.equal(tokens.some((entry) => entry.line === 1 && entry.type === "table"), true);
});

test("GaugeSemanticTokensProvider tokenizes blank-separated table rows as new headers", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const document = {
    getText() {
      return [
        "# Inventory",
        "| user |",
        "| Bob  |",
        "",
        "| <item> | quantity |",
        "| book   | 2        |",
      ].join("\n");
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));
  const secondHeaderTokens = tokens
    .filter((entry) => entry.line === 4 && entry.type === "tableHeader")
    .map(({ start, length }) => ({ start, length }));

  assert.deepEqual(tokens.filter((entry) => entry.line === 4 && entry.type === "argument"), []);
  assert.deepEqual(tokens.filter((entry) => entry.line === 4 && entry.type === "table"), []);
  assert.deepEqual(secondHeaderTokens, [
    { start: 1, length: 8 },
    { start: 10, length: 10 },
  ]);
});

test("GaugeSemanticTokensProvider keeps contiguous table rows as body rows before later separators", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const document = {
    getText() {
      return [
        "| user |",
        "| ---- |",
        "| <item> |",
        "| ---- |",
      ].join("\n");
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));

  assert.equal(tokens.some((entry) => entry.line === 2 && entry.type === "tableHeader"), false);
  assert.equal(tokens.some((entry) => entry.line === 2 && entry.type === "dynamicArgument"), true);
  assert.equal(tokens.some((entry) => entry.line === 3 && entry.type === "tableHeaderSeparator"), false);
});

test("GaugeSemanticTokensProvider treats indented top-level table markers as comments", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const document = {
    getText() {
      return [
        "  | <user> | role |",
        "  | ------ | ---- |",
        "* Real <item>",
      ].join("\n");
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));

  assert.deepEqual(tokens.filter((entry) => entry.line < 2).map((entry) => entry.type), [
    "gaugeComment",
    "gaugeComment",
  ]);
  assert.deepEqual(tokens.filter((entry) => entry.line === 2).map((entry) => entry.type), [
    "stepMarker",
    "step",
    "dynamicArgument",
  ]);
});

test("GaugeSemanticTokensProvider treats unterminated table rows as comments", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const document = {
    getText() {
      return [
        "| name",
        "* Real step",
      ].join("\n");
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));

  assert.deepEqual(tokens.filter((entry) => entry.line === 0).map((entry) => entry.type), [
    "gaugeComment",
  ]);
  assert.deepEqual(tokens.filter((entry) => entry.line === 1).map((entry) => entry.type), [
    "stepMarker",
    "step",
  ]);
});

test("GaugeSemanticTokensProvider tokenizes indented inline tables after steps", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const tableArgumentLine = "    | <third> |Project|";
  const document = {
    getText() {
      return [
        "* Step that takes a table",
        "    |Product|Description|",
        "    |-------|-----------|",
        "    |Gauge  |BDD style  |",
        tableArgumentLine,
      ].join("\n");
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));

  assert.deepEqual(tokens.filter((entry) => entry.line === 0).map((entry) => entry.type), [
    "stepMarker",
    "step",
  ]);
  assert.equal(tokens.some((entry) => entry.line === 1 && entry.type === "tableHeader"), true);
  assert.equal(tokens.some((entry) => entry.line === 1 && entry.type === "tableBorder"), true);
  assert.equal(tokens.some((entry) => entry.line === 2 && entry.type === "tableHeaderSeparator"), true);
  assert.equal(tokens.some((entry) => entry.line === 3 && entry.type === "table"), true);
  assert.equal(tokens.some((entry) => (
    entry.line === 4
    && entry.type === "dynamicArgument"
    && entry.start === tableArgumentLine.indexOf("<third>")
    && entry.length === "<third>".length
  )), true);
  assert.equal(tokens.some((entry) => entry.line > 0 && entry.type === "gaugeComment"), false);
});

test("GaugeSemanticTokensProvider keeps escaped table pipes in cell tokens", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const row = "| Ada \\| Bob | admin |";
  const document = {
    getText() {
      return [
        "| name | role |",
        row,
      ].join("\n");
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));
  const escapedPipeStart = row.indexOf("\\|");
  const middleBorderStart = row.indexOf("|", escapedPipeStart + 2);
  const borderStarts = tokens
    .filter((entry) => entry.line === 1 && entry.type === "tableBorder")
    .map((entry) => entry.start);

  assert.deepEqual(borderStarts, [0, middleBorderStart, row.length - 1]);
  assert.equal(tokens.some((entry) => (
    entry.line === 1
    && entry.type === "table"
    && entry.start <= escapedPipeStart
    && entry.start + entry.length >= escapedPipeStart + 2
  )), true);
});

test("GaugeSemanticTokensProvider treats even-backslash table pipes as borders", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const row = "| C:\\\\| Ada | admin |";
  const document = {
    getText() {
      return [
        "| path | user | role |",
        row,
      ].join("\n");
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));
  const evenBackslashPipeStart = row.indexOf("\\\\|") + 2;
  const borderStarts = tokens
    .filter((entry) => entry.line === 1 && entry.type === "tableBorder")
    .map((entry) => entry.start);

  assert.deepEqual(borderStarts, [0, evenBackslashPipeStart, row.indexOf("|", evenBackslashPipeStart + 1), row.length - 1]);
});

test("GaugeSemanticTokensProvider tokenizes single-column table separators", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const document = {
    getText() {
      return [
        "| user |",
        "| ---- |",
      ].join("\n");
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));
  const separatorTokens = tokens.filter((entry) => entry.line === 1);

  assert.equal(separatorTokens.some((entry) => entry.type === "tableHeaderSeparator"), true);
  assert.deepEqual(
    separatorTokens.filter((entry) => entry.type === "tableBorder").map((entry) => entry.start),
    [0, 7],
  );
});

test("GaugeSemanticTokensProvider does not span dynamic table arguments across pipes", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const row = "| <user | admin> |";
  const document = {
    getText() {
      return row;
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));
  const argumentTokens = tokens.filter((entry) => entry.type === "dynamicArgument");
  const dynamicBoundary = row.indexOf("|", row.indexOf("<"));
  const borderStarts = tokens
    .filter((entry) => entry.type === "tableBorder")
    .map((entry) => entry.start);

  assert.deepEqual(argumentTokens, []);
  assert.equal(borderStarts.includes(dynamicBoundary), true);
});

test("GaugeSemanticTokensProvider tokenizes escaped dynamic step arguments", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const step = "* Say <name \\> suffix>";
  const document = {
    getText() {
      return step;
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));
  const argumentTokens = tokens.filter((entry) => entry.type === "dynamicArgument");

  assert.deepEqual(argumentTokens, [
    {
      line: 0,
      start: step.indexOf("<"),
      length: step.length - step.indexOf("<"),
      tokenType: tokenTypes.indexOf("dynamicArgument"),
      tokenModifiers: 0,
      type: "dynamicArgument",
    },
  ]);
});

test("GaugeSemanticTokensProvider tokenizes escaped static step arguments", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const step = "* Say \"Ada \\\"The First\\\"\" now";
  const document = {
    getText() {
      return step;
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));
  const argumentTokens = tokens.filter((entry) => entry.type === "argument");
  const start = step.indexOf("\"");
  const end = step.lastIndexOf("\"") + 1;

  assert.deepEqual(argumentTokens, [
    {
      line: 0,
      start,
      length: end - start,
      tokenType: tokenTypes.indexOf("argument"),
      tokenModifiers: 0,
      type: "argument",
    },
  ]);
});

test("GaugeSemanticTokensProvider ignores escaped argument starts", () => {
  const {
    GaugeSemanticTokensProvider,
    tokenTypes,
  } = require("../src/semanticTokensProvider");
  const provider = new GaugeSemanticTokensProvider({
    SemanticTokensBuilder: CapturingSemanticTokensBuilder,
  });
  const step = "* Say \\<name> and \\\"Ada\" now";
  const document = {
    getText() {
      return step;
    },
  };

  const tokens = provider.provideDocumentSemanticTokens(document)
    .map((entry) => ({ ...entry, type: tokenTypes[entry.tokenType] }));
  const argumentTokens = tokens.filter((entry) => (
    entry.type === "argument" || entry.type === "dynamicArgument"
  ));

  assert.deepEqual(argumentTokens, []);
});
