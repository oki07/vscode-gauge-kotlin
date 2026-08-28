const assert = require("node:assert/strict");
const test = require("node:test");

function createFakeVscode() {
  return {
    CodeAction: class CodeAction {
      constructor(title, kind) {
        this.title = title;
        this.kind = kind;
      }
    },
    CodeActionKind: {
      QuickFix: "quickfix",
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
  };
}

function createDocument(lines, languageId = "gauge", fsPath = "/workspace/gauge/specs/checkout.spec") {
  return {
    languageId,
    lineCount: lines.length,
    uri: { fsPath },
    getText() {
      return lines.join("\n");
    },
    lineAt(line) {
      return { text: lines[line] };
    },
  };
}

test("GaugeStepCodeActionProvider creates a step implementation quick fix", () => {
  const {
    CREATE_STEP_IMPLEMENTATION_TITLE,
    GENERATE_STEP_STUB,
    GaugeStepCodeActionProvider,
    UNDEFINED_STEP_MESSAGE,
  } = require("../src/stepCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeStepCodeActionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "* Pay with <amount>",
  ]);
  const range = new vscode.Range(
    new vscode.Position(1, 0),
    new vscode.Position(1, 19),
  );

  const actions = provider.provideCodeActions(document, range, {
    diagnostics: [{ message: UNDEFINED_STEP_MESSAGE, range }],
  });

  assert.equal(actions.length, 2);
  assert.equal(actions[0].title, CREATE_STEP_IMPLEMENTATION_TITLE);
  assert.equal(actions[0].kind, "quickfix");
  assert.deepEqual(actions[0].diagnostics.map((diagnostic) => diagnostic.message), [
    UNDEFINED_STEP_MESSAGE,
  ]);
  assert.deepEqual(actions[0].command, {
    command: GENERATE_STEP_STUB,
    title: CREATE_STEP_IMPLEMENTATION_TITLE,
    arguments: [
      "@com.thoughtworks.gauge.Step(\"Pay with <amount>\")\nfun implementation(arg0: Any) {\n}\n",
    ],
  });
});

// The runner builds its suggested annotation from the PARAMETERIZED step value:
// references/gauge-java ValidateStepProcessor formats @Step("%s") from
// getStepValue().getParameterizedStepValue(). Verified against the real parser -
// ExtractStepValueAndParams on `Pay with "100"` gives
// value="Pay with {}", parameterized="Pay with <100>".
//
// Keeping the static literal instead produced an annotation the runner registers
// as `Pay with "100` (StepsUtil rewrites only <...>, Util.trimQuotes strips the
// trailing quote), which can never match `Pay with {}`. Worse, the extension's own
// index normalizes both to `Pay with {}`, so the Undefined Step diagnostic
// cleared and the editor said the step was implemented while `gauge run` still
// reported it missing.
test("GaugeStepCodeActionProvider parameterizes static arguments in the stub", () => {
  const {
    CREATE_STEP_IMPLEMENTATION_TITLE,
    GENERATE_STEP_STUB,
    GaugeStepCodeActionProvider,
    UNDEFINED_STEP_MESSAGE,
  } = require("../src/stepCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeStepCodeActionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "* Pay with \"100\"",
  ]);
  const range = new vscode.Range(
    new vscode.Position(1, 0),
    new vscode.Position(1, 16),
  );

  const actions = provider.provideCodeActions(document, range, {
    diagnostics: [{ message: UNDEFINED_STEP_MESSAGE, range }],
  });

  assert.equal(actions[0].title, CREATE_STEP_IMPLEMENTATION_TITLE);
  assert.deepEqual(actions[0].command, {
    command: GENERATE_STEP_STUB,
    title: CREATE_STEP_IMPLEMENTATION_TITLE,
    arguments: [
      "@com.thoughtworks.gauge.Step(\"Pay with <100>\")\nfun implementation(arg0: Any) {\n}\n",
    ],
  });
});

test("GaugeStepCodeActionProvider leaves runner-authored diagnostics to Gauge LSP", () => {
  const { GaugeStepCodeActionProvider } = require("../src/stepCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeStepCodeActionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "* Pay with <amount>",
  ]);
  const range = new vscode.Range(
    new vscode.Position(1, 0),
    new vscode.Position(1, 19),
  );

  const actions = provider.provideCodeActions(document, range, {
    diagnostics: [{
      message: "Step implementation not found",
      range,
      code: "expected generated stub",
      source: "gauge",
    }],
  });

  assert.deepEqual(actions, []);
});

test("GaugeStepCodeActionProvider creates fixes for multiline Gauge steps when project allows them", () => {
  const {
    CREATE_CONCEPT_TITLE,
    CREATE_STEP_IMPLEMENTATION_TITLE,
    GENERATE_CONCEPT_STUB,
    GENERATE_STEP_STUB,
    GaugeStepCodeActionProvider,
    UNDEFINED_STEP_MESSAGE,
  } = require("../src/stepCodeActions");
  const originalAllowMultiline = process.env.allow_multiline_step;
  delete process.env.allow_multiline_step;
  const vscode = createFakeVscode();
  const provider = new GaugeStepCodeActionProvider({
    fileSystem: {
      readFileSync(filename, encoding) {
        assert.equal(filename, "/workspace/gauge/env/default/default.properties");
        assert.equal(encoding, "utf8");
        return "allow_multiline_step = true\n";
      },
    },
    projectFactory: {
      getGaugeRootFromFilePath(file) {
        assert.equal(file, "/workspace/gauge/specs/checkout.spec");
        return "/workspace/gauge";
      },
      isGaugeProject(root) {
        assert.equal(root, "/workspace/gauge");
        return true;
      },
    },
    vscode,
  });
  const document = createDocument([
    "# Checkout",
    "* Pay with",
    "card <amount>",
  ]);
  const range = new vscode.Range(
    new vscode.Position(1, 0),
    new vscode.Position(2, 13),
  );

  try {
    const actions = provider.provideCodeActions(document, range, {
      diagnostics: [{ message: UNDEFINED_STEP_MESSAGE, range }],
    });

    assert.equal(actions.length, 2);
    assert.deepEqual(actions[0].command, {
      command: GENERATE_STEP_STUB,
      title: CREATE_STEP_IMPLEMENTATION_TITLE,
      arguments: [
        "@com.thoughtworks.gauge.Step(\"Pay with card <amount>\")\nfun implementation(arg0: Any) {\n}\n",
      ],
    });
    assert.equal(actions[1].title, CREATE_CONCEPT_TITLE);
    assert.deepEqual(actions[1].command, {
      command: GENERATE_CONCEPT_STUB,
      title: CREATE_CONCEPT_TITLE,
      arguments: [
        {
          conceptName: "# Pay with card <arg0>\n* ",
          conceptFile: "",
          dir: "",
        },
      ],
    });
  } finally {
    if (originalAllowMultiline === undefined) {
      delete process.env.allow_multiline_step;
    } else {
      process.env.allow_multiline_step = originalAllowMultiline;
    }
  }
});

test("GaugeStepCodeActionProvider does not reinterpret Gauge LSP stub code", () => {
  const { GaugeStepCodeActionProvider } = require("../src/stepCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeStepCodeActionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "* Pay with <amount>",
  ]);
  const range = new vscode.Range(
    new vscode.Position(1, 0),
    new vscode.Position(1, 19),
  );
  const diagnostic = {
    message: "Step implementation not found",
    range,
    code: "expected generated stub",
  };

  const actions = provider.provideCodeActions(document, range, {
    diagnostics: [diagnostic],
  });

  assert.deepEqual(actions, []);
});

test("GaugeStepCodeActionProvider ignores local undefined-step diagnostic code identifiers", () => {
  const {
    CREATE_STEP_IMPLEMENTATION_TITLE,
    GENERATE_STEP_STUB,
    GaugeStepCodeActionProvider,
    UNDEFINED_STEP_MESSAGE,
  } = require("../src/stepCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeStepCodeActionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "* Pay with <amount>",
  ]);
  const range = new vscode.Range(
    new vscode.Position(1, 0),
    new vscode.Position(1, 19),
  );

  const actions = provider.provideCodeActions(document, range, {
    diagnostics: [{
      message: UNDEFINED_STEP_MESSAGE,
      range,
      code: "gauge.undefinedStep",
    }],
  });

  assert.equal(actions.length, 2);
  assert.deepEqual(actions[0].command, {
    command: GENERATE_STEP_STUB,
    title: CREATE_STEP_IMPLEMENTATION_TITLE,
    arguments: [
      "@com.thoughtworks.gauge.Step(\"Pay with <amount>\")\nfun implementation(arg0: Any) {\n}\n",
    ],
  });
});

test("GaugeStepCodeActionProvider creates fixes for gauge validate missing implementation diagnostics", () => {
  const {
    CREATE_STEP_IMPLEMENTATION_TITLE,
    GENERATE_STEP_STUB,
    GaugeStepCodeActionProvider,
  } = require("../src/stepCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeStepCodeActionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "* Pay with <amount>",
  ]);
  const range = new vscode.Range(
    new vscode.Position(1, 0),
    new vscode.Position(1, 19),
  );
  const diagnostic = {
    message: "[ValidationError] line number: 2, Step implementation not found => 'Pay with <amount>'",
    range,
    code: "gauge.validate",
    source: "gauge",
  };

  const actions = provider.provideCodeActions(document, range, {
    diagnostics: [diagnostic],
  });

  assert.equal(actions.length, 2);
  assert.equal(actions[0].title, CREATE_STEP_IMPLEMENTATION_TITLE);
  assert.deepEqual(actions[0].diagnostics, [diagnostic]);
  assert.deepEqual(actions[0].command, {
    command: GENERATE_STEP_STUB,
    title: CREATE_STEP_IMPLEMENTATION_TITLE,
    arguments: [
      "@com.thoughtworks.gauge.Step(\"Pay with <amount>\")\nfun implementation(arg0: Any) {\n}\n",
    ],
  });
});

test("GaugeStepCodeActionProvider ignores Gauge LSP stub code outside step lines", () => {
  const { GaugeStepCodeActionProvider } = require("../src/stepCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeStepCodeActionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "* Pay with <amount>",
  ]);
  const range = new vscode.Range(
    new vscode.Position(0, 0),
    new vscode.Position(0, 0),
  );
  const diagnostic = {
    message: "Step implementation not found",
    range,
    code: "expected generated stub",
  };

  const actions = provider.provideCodeActions(document, range, {
    diagnostics: [diagnostic],
  });

  assert.deepEqual(actions, []);
});

test("GaugeStepCodeActionProvider creates a Java step implementation quick fix for Java projects", () => {
  const {
    CREATE_STEP_IMPLEMENTATION_TITLE,
    GENERATE_STEP_STUB,
    GaugeStepCodeActionProvider,
    UNDEFINED_STEP_MESSAGE,
  } = require("../src/stepCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeStepCodeActionProvider({
    projectFactory: {
      getGaugeRootFromFilePath(file) {
        assert.equal(file, "/workspace/gauge/specs/checkout.spec");
        return "/workspace/gauge";
      },
      getProjectByFilepath(file) {
        assert.equal(file, "/workspace/gauge/specs/checkout.spec");
        return {
          language() {
            return "java";
          },
        };
      },
      isGaugeProject(root) {
        assert.equal(root, "/workspace/gauge");
        return true;
      },
    },
    vscode,
  });
  const document = createDocument([
    "# Checkout",
    "* Pay with <amount>",
  ]);
  const range = new vscode.Range(
    new vscode.Position(1, 0),
    new vscode.Position(1, 19),
  );

  const actions = provider.provideCodeActions(document, range, {
    diagnostics: [{ message: UNDEFINED_STEP_MESSAGE, range }],
  });

  assert.equal(actions.length, 2);
  assert.equal(actions[0].title, CREATE_STEP_IMPLEMENTATION_TITLE);
  assert.deepEqual(actions[0].command, {
    command: GENERATE_STEP_STUB,
    title: CREATE_STEP_IMPLEMENTATION_TITLE,
    arguments: [
      "@com.thoughtworks.gauge.Step(\"Pay with <amount>\")\npublic void implementation(Object arg0) {\n}\n",
    ],
  });
});

test("GaugeStepCodeActionProvider creates a concept quick fix for undefined steps", () => {
  const {
    CREATE_CONCEPT_TITLE,
    CREATE_STEP_IMPLEMENTATION_TITLE,
    GENERATE_CONCEPT_STUB,
    GENERATE_STEP_STUB,
    GaugeStepCodeActionProvider,
    UNDEFINED_STEP_MESSAGE,
  } = require("../src/stepCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeStepCodeActionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "* Pay with <amount>",
  ]);
  const range = new vscode.Range(
    new vscode.Position(1, 0),
    new vscode.Position(1, 19),
  );

  const actions = provider.provideCodeActions(document, range, {
    diagnostics: [{ message: UNDEFINED_STEP_MESSAGE, range }],
  });

  assert.equal(actions.length, 2);
  assert.equal(actions[0].title, CREATE_STEP_IMPLEMENTATION_TITLE);
  assert.deepEqual(actions[0].command.command, GENERATE_STEP_STUB);
  assert.equal(actions[1].title, CREATE_CONCEPT_TITLE);
  assert.deepEqual(actions[1].command, {
    command: GENERATE_CONCEPT_STUB,
    title: CREATE_CONCEPT_TITLE,
    arguments: [
      {
        conceptName: "# Pay with <arg0>\n* ",
        conceptFile: "",
        dir: "",
      },
    ],
  });
});

test("GaugeStepCodeActionProvider escapes Kotlin string templates in step stubs", () => {
  const {
    CREATE_STEP_IMPLEMENTATION_TITLE,
    GENERATE_STEP_STUB,
    GaugeStepCodeActionProvider,
    UNDEFINED_STEP_MESSAGE,
  } = require("../src/stepCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeStepCodeActionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "* Pay $amount",
  ]);
  const range = new vscode.Range(
    new vscode.Position(1, 0),
    new vscode.Position(1, 13),
  );

  const actions = provider.provideCodeActions(document, range, {
    diagnostics: [{ message: UNDEFINED_STEP_MESSAGE, range }],
  });

  assert.equal(actions.length, 2);
  assert.deepEqual(actions[0].command, {
    command: GENERATE_STEP_STUB,
    title: CREATE_STEP_IMPLEMENTATION_TITLE,
    arguments: [
      "@com.thoughtworks.gauge.Step(\"Pay \\$amount\")\nfun implementation() {\n}\n",
    ],
  });
});

test("GaugeStepCodeActionProvider includes inline table arguments in step stubs", () => {
  const {
    CREATE_STEP_IMPLEMENTATION_TITLE,
    GENERATE_STEP_STUB,
    GaugeStepCodeActionProvider,
    UNDEFINED_STEP_MESSAGE,
  } = require("../src/stepCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeStepCodeActionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "* Pay with account",
    "  | id |",
    "  | 42 |",
  ]);
  const range = new vscode.Range(
    new vscode.Position(1, 0),
    new vscode.Position(1, 18),
  );

  const actions = provider.provideCodeActions(document, range, {
    diagnostics: [{ message: UNDEFINED_STEP_MESSAGE, range }],
  });

  assert.equal(actions.length, 2);
  assert.deepEqual(actions[0].command, {
    command: GENERATE_STEP_STUB,
    title: CREATE_STEP_IMPLEMENTATION_TITLE,
    arguments: [
      "@com.thoughtworks.gauge.Step(\"Pay with account <table>\")\nfun implementation(arg0: Any) {\n}\n",
    ],
  });
});

test("GaugeStepCodeActionProvider includes table rows without closing pipes in step stubs", () => {
  const {
    CREATE_STEP_IMPLEMENTATION_TITLE,
    GENERATE_STEP_STUB,
    GaugeStepCodeActionProvider,
    UNDEFINED_STEP_MESSAGE,
  } = require("../src/stepCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeStepCodeActionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "* Pay with account",
    "  | id",
  ]);
  const range = new vscode.Range(
    new vscode.Position(1, 0),
    new vscode.Position(1, 18),
  );

  const actions = provider.provideCodeActions(document, range, {
    diagnostics: [{ message: UNDEFINED_STEP_MESSAGE, range }],
  });

  assert.equal(actions.length, 2);
  assert.deepEqual(actions[0].command, {
    command: GENERATE_STEP_STUB,
    title: CREATE_STEP_IMPLEMENTATION_TITLE,
    arguments: [
      "@com.thoughtworks.gauge.Step(\"Pay with account <table>\")\nfun implementation(arg0: Any) {\n}\n",
    ],
  });
});

test("GaugeStepCodeActionProvider includes docstring arguments in step stubs", () => {
  const {
    CREATE_STEP_IMPLEMENTATION_TITLE,
    GENERATE_STEP_STUB,
    GaugeStepCodeActionProvider,
    UNDEFINED_STEP_MESSAGE,
  } = require("../src/stepCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeStepCodeActionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "* Execute the following content",
    "\"\"\"",
    "payload",
    "\"\"\"",
  ]);
  const range = new vscode.Range(
    new vscode.Position(1, 0),
    new vscode.Position(1, 31),
  );

  const actions = provider.provideCodeActions(document, range, {
    diagnostics: [{ message: UNDEFINED_STEP_MESSAGE, range }],
  });

  assert.equal(actions.length, 2);
  assert.deepEqual(actions[0].command, {
    command: GENERATE_STEP_STUB,
    title: CREATE_STEP_IMPLEMENTATION_TITLE,
    arguments: [
      "@com.thoughtworks.gauge.Step(\"Execute the following content\")\nfun implementation(arg0: Any) {\n}\n",
    ],
  });
});

test("GaugeStepCodeActionProvider ignores unterminated docstrings in step stubs", () => {
  const {
    CREATE_STEP_IMPLEMENTATION_TITLE,
    GENERATE_STEP_STUB,
    GaugeStepCodeActionProvider,
    UNDEFINED_STEP_MESSAGE,
  } = require("../src/stepCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeStepCodeActionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "* Execute content",
    "\"\"\"",
    "payload",
  ]);
  const range = new vscode.Range(
    new vscode.Position(1, 0),
    new vscode.Position(1, 17),
  );

  const actions = provider.provideCodeActions(document, range, {
    diagnostics: [{ message: UNDEFINED_STEP_MESSAGE, range }],
  });

  assert.equal(actions.length, 2);
  assert.deepEqual(actions[0].command, {
    command: GENERATE_STEP_STUB,
    title: CREATE_STEP_IMPLEMENTATION_TITLE,
    arguments: [
      "@com.thoughtworks.gauge.Step(\"Execute content\")\nfun implementation() {\n}\n",
    ],
  });
});

test("GaugeStepCodeActionProvider creates fixes for indented Gauge steps", () => {
  const {
    CREATE_STEP_IMPLEMENTATION_TITLE,
    GENERATE_STEP_STUB,
    GaugeStepCodeActionProvider,
    UNDEFINED_STEP_MESSAGE,
  } = require("../src/stepCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeStepCodeActionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "  * Draft pay with <amount>",
  ]);
  const range = new vscode.Range(
    new vscode.Position(1, 2),
    new vscode.Position(1, 27),
  );

  const actions = provider.provideCodeActions(document, range, {
    diagnostics: [{ message: UNDEFINED_STEP_MESSAGE, range }],
  });

  assert.equal(actions.length, 2);
  assert.deepEqual(actions[0].command, {
    command: GENERATE_STEP_STUB,
    title: CREATE_STEP_IMPLEMENTATION_TITLE,
    arguments: [
      "@com.thoughtworks.gauge.Step(\"Draft pay with <amount>\")\nfun implementation(arg0: Any) {\n}\n",
    ],
  });
});

test("GaugeStepCodeActionProvider creates fixes for markdown Gauge specs", () => {
  const {
    CREATE_STEP_IMPLEMENTATION_TITLE,
    GENERATE_STEP_STUB,
    GaugeStepCodeActionProvider,
    UNDEFINED_STEP_MESSAGE,
  } = require("../src/stepCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeStepCodeActionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "* Pay with <amount>",
  ], "markdown", "/workspace/gauge/specs/checkout.md");
  const range = new vscode.Range(
    new vscode.Position(1, 0),
    new vscode.Position(1, 19),
  );

  const actions = provider.provideCodeActions(document, range, {
    diagnostics: [{ message: UNDEFINED_STEP_MESSAGE, range }],
  });

  assert.equal(actions.length, 2);
  assert.deepEqual(actions[0].command, {
    command: GENERATE_STEP_STUB,
    title: CREATE_STEP_IMPLEMENTATION_TITLE,
    arguments: [
      "@com.thoughtworks.gauge.Step(\"Pay with <amount>\")\nfun implementation(arg0: Any) {\n}\n",
    ],
  });
});

test("GaugeStepCodeActionProvider creates fixes for concept files by extension", () => {
  const {
    CREATE_STEP_IMPLEMENTATION_TITLE,
    GENERATE_STEP_STUB,
    GaugeStepCodeActionProvider,
    UNDEFINED_STEP_MESSAGE,
  } = require("../src/stepCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeStepCodeActionProvider({
    projectFactory: {
      getGaugeRootFromFilePath(file) {
        assert.equal(file, "/workspace/gauge/specs/concepts/payment.cpt");
        return "/workspace/gauge";
      },
      isGaugeProject(root) {
        assert.equal(root, "/workspace/gauge");
        return true;
      },
    },
    vscode,
  });
  const document = createDocument([
    "# Shared checkout",
    "* Pay with <amount>",
  ], "plaintext", "/workspace/gauge/specs/concepts/payment.cpt");
  const range = new vscode.Range(
    new vscode.Position(1, 0),
    new vscode.Position(1, 19),
  );

  const actions = provider.provideCodeActions(document, range, {
    diagnostics: [{ message: UNDEFINED_STEP_MESSAGE, range }],
  });

  assert.equal(actions.length, 2);
  assert.deepEqual(actions[0].command, {
    command: GENERATE_STEP_STUB,
    title: CREATE_STEP_IMPLEMENTATION_TITLE,
    arguments: [
      "@com.thoughtworks.gauge.Step(\"Pay with <amount>\")\nfun implementation(arg0: Any) {\n}\n",
    ],
  });
});

test("GaugeStepCodeActionProvider creates fixes for gauge-concept documents by language id", () => {
  const {
    CREATE_CONCEPT_TITLE,
    CREATE_STEP_IMPLEMENTATION_TITLE,
    GENERATE_CONCEPT_STUB,
    GENERATE_STEP_STUB,
    GaugeStepCodeActionProvider,
    UNDEFINED_STEP_MESSAGE,
  } = require("../src/stepCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeStepCodeActionProvider({
    projectFactory: {
      getGaugeRootFromFilePath(file) {
        assert.equal(file, "/workspace/gauge/specs/concepts/payment");
        return "/workspace/gauge";
      },
      isGaugeProject(root) {
        assert.equal(root, "/workspace/gauge");
        return true;
      },
    },
    vscode,
  });
  const document = createDocument([
    "# Shared checkout",
    "* Pay with <amount>",
  ], "gauge-concept", "/workspace/gauge/specs/concepts/payment");
  const range = new vscode.Range(
    new vscode.Position(1, 0),
    new vscode.Position(1, 19),
  );

  const actions = provider.provideCodeActions(document, range, {
    diagnostics: [{ message: UNDEFINED_STEP_MESSAGE, range }],
  });

  assert.equal(actions.length, 2);
  assert.equal(actions[0].title, CREATE_STEP_IMPLEMENTATION_TITLE);
  assert.deepEqual(actions[0].command, {
    command: GENERATE_STEP_STUB,
    title: CREATE_STEP_IMPLEMENTATION_TITLE,
    arguments: [
      "@com.thoughtworks.gauge.Step(\"Pay with <amount>\")\nfun implementation(arg0: Any) {\n}\n",
    ],
  });
  assert.equal(actions[1].title, CREATE_CONCEPT_TITLE);
  assert.deepEqual(actions[1].command, {
    command: GENERATE_CONCEPT_STUB,
    title: CREATE_CONCEPT_TITLE,
    arguments: [
      {
        conceptName: "# Pay with <arg0>\n* ",
        conceptFile: "",
        dir: "",
      },
    ],
  });
});

test("GaugeStepCodeActionProvider ignores Gauge files by extension outside Gauge projects", () => {
  const {
    GaugeStepCodeActionProvider,
    UNDEFINED_STEP_MESSAGE,
  } = require("../src/stepCodeActions");
  const vscode = createFakeVscode();
  const checkedFiles = [];
  const provider = new GaugeStepCodeActionProvider({
    projectFactory: {
      getGaugeRootFromFilePath(file) {
        checkedFiles.push(file);
        throw new Error("not a Gauge project");
      },
    },
    vscode,
  });
  const range = new vscode.Range(
    new vscode.Position(1, 0),
    new vscode.Position(1, 19),
  );

  const specActions = provider.provideCodeActions(
    createDocument([
      "# Checkout",
      "* Pay with <amount>",
    ], "plaintext", "/workspace/docs/checkout.spec"),
    range,
    { diagnostics: [{ message: UNDEFINED_STEP_MESSAGE, range }] },
  );
  const conceptActions = provider.provideCodeActions(
    createDocument([
      "# Shared checkout",
      "* Pay with <amount>",
    ], "plaintext", "/workspace/docs/concepts/payment.cpt"),
    range,
    { diagnostics: [{ message: UNDEFINED_STEP_MESSAGE, range }] },
  );

  assert.deepEqual(specActions, []);
  assert.deepEqual(conceptActions, []);
  assert.deepEqual(checkedFiles, [
    "/workspace/docs/checkout.spec",
    "/workspace/docs/concepts/payment.cpt",
  ]);
});

test("GaugeStepCodeActionProvider defers duplicate Kotlin stub names until destination selection", () => {
  const {
    CREATE_STEP_IMPLEMENTATION_TITLE,
    GENERATE_STEP_STUB,
    GaugeStepCodeActionProvider,
    UNDEFINED_STEP_MESSAGE,
  } = require("../src/stepCodeActions");
  const vscode = {
    ...createFakeVscode(),
    workspace: {
      textDocuments: [
        {
          languageId: "kotlin",
          uri: { fsPath: "/workspace/gauge/src/test/kotlin/Steps.kt" },
          getText() {
            return [
              "import com.thoughtworks.gauge.Step",
              "",
              "@Step(\"Pay with <amount>\")",
              "fun implementation(arg0: Any) {",
              "}",
            ].join("\n");
          },
        },
      ],
    },
  };
  const provider = new GaugeStepCodeActionProvider({ vscode });
  const document = createDocument([
    "# Checkout",
    "* Refund <amount>",
  ]);
  const range = new vscode.Range(
    new vscode.Position(1, 0),
    new vscode.Position(1, 17),
  );

  const actions = provider.provideCodeActions(document, range, {
    diagnostics: [{ message: UNDEFINED_STEP_MESSAGE, range }],
  });

  assert.equal(actions.length, 2);
  assert.deepEqual(actions[0].command, {
    command: GENERATE_STEP_STUB,
    title: CREATE_STEP_IMPLEMENTATION_TITLE,
    arguments: [
      "@com.thoughtworks.gauge.Step(\"Refund <amount>\")\nfun implementation(arg0: Any) {\n}\n",
    ],
  });
});
