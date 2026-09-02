const assert = require("node:assert/strict");
const path = require("node:path");
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
      "@com.thoughtworks.gauge.Step(\"Pay with <amount>\")\nfun implementation(arg0: Any) {\n    TODO(\"Provide custom implementation\")\n}\n",
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
      "@com.thoughtworks.gauge.Step(\"Pay with <100>\")\nfun implementation(arg0: Any) {\n    TODO(\"Provide custom implementation\")\n}\n",
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
        "@com.thoughtworks.gauge.Step(\"Pay with card <amount>\")\nfun implementation(arg0: Any) {\n    TODO(\"Provide custom implementation\")\n}\n",
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
      "@com.thoughtworks.gauge.Step(\"Pay with <amount>\")\nfun implementation(arg0: Any) {\n    TODO(\"Provide custom implementation\")\n}\n",
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

// A Kotlin Gauge project runs on the gauge-java runner, so its manifest says
// "Language": "java" - the manifest can never tell Kotlin from Java. Deciding
// the stub language from it made the Kotlin branch dead code and emitted
// "public void implementation(Object arg0)" into every Kotlin project, which
// does not compile there. The source layout is the signal that can tell them
// apart.
// The braces Gauge reserves are written "\\{" in the spec and reach the runner
// unescaped: the real parser gives "* cost is \\{5\\}" the value "cost is {5}",
// and the registry key is whatever the annotation literally says
// (references/gauge-java RegistryMethodVisitor -> StepsUtil.getStepText, which
// leaves braces alone). Emitting the raw spec text and then escaping the
// backslash again for Kotlin registered "cost is \\{5\\}", which the runner can
// never match - and the editor stayed green about it.
test("GaugeStepCodeActionProvider resolves Gauge brace escapes in the generated annotation", () => {
  const {
    GENERATE_STEP_STUB,
    GaugeStepCodeActionProvider,
    UNDEFINED_STEP_MESSAGE,
  } = require("../src/stepCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeStepCodeActionProvider({ vscode });
  const document = createDocument([
    "# Costs",
    "* cost is \\{5\\}",
  ]);
  const range = new vscode.Range(
    new vscode.Position(1, 0),
    new vscode.Position(1, 16),
  );

  const actions = provider.provideCodeActions(document, range, {
    diagnostics: [{ message: UNDEFINED_STEP_MESSAGE, range }],
  });

  assert.deepEqual(actions[0].command, {
    command: GENERATE_STEP_STUB,
    title: actions[0].command.title,
    arguments: [
      "@com.thoughtworks.gauge.Step(\"cost is {5}\")\nfun implementation() {\n    TODO(\"Provide custom implementation\")\n}\n",
    ],
  });
});

// A step may carry a doc string AND a table. Stopping the table scan at the
// opening fence generated an annotation without <table>, which CLEARED the
// "Undefined Step" the fix was offered for and left the runner still answering
// "Step implementation not found". Probed: the real parser gives this step the
// value "Load the payload {}" with the args [special_string, table].
test("GaugeStepCodeActionProvider includes the table of a step that also has a doc string", () => {
  const {
    GENERATE_STEP_STUB,
    GaugeStepCodeActionProvider,
    UNDEFINED_STEP_MESSAGE,
  } = require("../src/stepCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeStepCodeActionProvider({ vscode });
  const document = createDocument([
    "# Payloads",
    "* Load the payload",
    "\"\"\"",
    "body",
    "\"\"\"",
    "|id|",
    "|--|",
    "|1 |",
  ]);
  const range = new vscode.Range(
    new vscode.Position(1, 0),
    new vscode.Position(1, 18),
  );

  const actions = provider.provideCodeActions(document, range, {
    diagnostics: [{ message: UNDEFINED_STEP_MESSAGE, range }],
  });

  assert.match(actions[0].command.arguments[0], /Step\("Load the payload <table>"\)/);
});

test("GaugeStepCodeActionProvider creates a Kotlin step implementation quick fix for Kotlin sources", () => {
  const {
    CREATE_STEP_IMPLEMENTATION_TITLE,
    GENERATE_STEP_STUB,
    GaugeStepCodeActionProvider,
    UNDEFINED_STEP_MESSAGE,
  } = require("../src/stepCodeActions");
  const vscode = createFakeVscode();
  const provider = new GaugeStepCodeActionProvider({
    fileSystem: {
      existsSync(file) {
        return file === "/workspace/gauge/src/test/kotlin";
      },
    },
    pathModule: path.posix,
    projectFactory: {
      getGaugeRootFromFilePath() {
        return "/workspace/gauge";
      },
      getProjectByFilepath() {
        return {
          language() {
            return "java";
          },
        };
      },
      isGaugeProject() {
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

  assert.deepEqual(actions[0].command.arguments, [
    "@com.thoughtworks.gauge.Step(\"Pay with <amount>\")\nfun implementation(arg0: Any) {\n    TODO(\"Provide custom implementation\")\n}\n",
  ]);
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
      "@com.thoughtworks.gauge.Step(\"Pay with <amount>\")\npublic void implementation(Object arg0) {\n    throw new UnsupportedOperationException(\"Provide custom implementation\");\n}\n",
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
      "@com.thoughtworks.gauge.Step(\"Pay \\$amount\")\nfun implementation() {\n    TODO(\"Provide custom implementation\")\n}\n",
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
      "@com.thoughtworks.gauge.Step(\"Pay with account <table>\")\nfun implementation(arg0: Any) {\n    TODO(\"Provide custom implementation\")\n}\n",
    ],
  });
});

// "| id" has no closing "|", so it is a comment and the step takes no table.
// Generating a "<table>" stub for it produced an annotation that can never
// match the step Gauge actually looks for.
test("GaugeStepCodeActionProvider omits a table stub for a pipe line with no closing pipe", () => {
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
      "@com.thoughtworks.gauge.Step(\"Pay with account\")\nfun implementation() {\n    TODO(\"Provide custom implementation\")\n}\n",
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
      "@com.thoughtworks.gauge.Step(\"Execute the following content\")\nfun implementation(arg0: Any) {\n    TODO(\"Provide custom implementation\")\n}\n",
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
      "@com.thoughtworks.gauge.Step(\"Execute content\")\nfun implementation() {\n    TODO(\"Provide custom implementation\")\n}\n",
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
      "@com.thoughtworks.gauge.Step(\"Draft pay with <amount>\")\nfun implementation(arg0: Any) {\n    TODO(\"Provide custom implementation\")\n}\n",
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
      "@com.thoughtworks.gauge.Step(\"Pay with <amount>\")\nfun implementation(arg0: Any) {\n    TODO(\"Provide custom implementation\")\n}\n",
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
      "@com.thoughtworks.gauge.Step(\"Pay with <amount>\")\nfun implementation(arg0: Any) {\n    TODO(\"Provide custom implementation\")\n}\n",
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
      "@com.thoughtworks.gauge.Step(\"Pay with <amount>\")\nfun implementation(arg0: Any) {\n    TODO(\"Provide custom implementation\")\n}\n",
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
      "@com.thoughtworks.gauge.Step(\"Refund <amount>\")\nfun implementation(arg0: Any) {\n    TODO(\"Provide custom implementation\")\n}\n",
    ],
  });
});

// A generated stub must FAIL until someone writes the body. gauge-java's own
// suggestion, which the reference extension inserts verbatim, ends with
// `throw new UnsupportedOperationException("Provide custom implementation");`
// (references/gauge-java .../processor/ValidateStepProcessor.java validateStep).
//
// Measured by running gauge-java's own MethodExecutor over each body shape,
// compiled by the bundled Gradle template against gauge-java 1.0.3:
//   empty body        -> failed=false
//   TODO(...)         -> failed=true  kotlin.NotImplementedError: An operation
//                                     is not implemented: Provide custom
//                                     implementation
//   throw Unsupported -> failed=true  java.lang.UnsupportedOperationException:
//                                     Provide custom implementation
// An empty body therefore reports the un-implemented step as PASSED, and a
// suite stubbed this way is green while asserting nothing. MethodExecutor
// catches Throwable, so Kotlin's TODO is reported as a step failure like any
// exception.
test("a generated step stub fails until it is implemented", () => {
  const { javaStepStubCode, stepStubCode } = require("../src/stepCodeActions");

  assert.equal(
    stepStubCode("Pay with <amount>"),
    "@com.thoughtworks.gauge.Step(\"Pay with <amount>\")\n"
    + "fun implementation(arg0: Any) {\n"
    + "    TODO(\"Provide custom implementation\")\n"
    + "}\n",
  );
  assert.equal(
    javaStepStubCode("Pay with <amount>"),
    "@com.thoughtworks.gauge.Step(\"Pay with <amount>\")\n"
    + "public void implementation(Object arg0) {\n"
    + "    throw new UnsupportedOperationException(\"Provide custom implementation\");\n"
    + "}\n",
  );
});
