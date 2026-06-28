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

function createDocument(lines) {
  return {
    languageId: "gauge",
    uri: { fsPath: "/workspace/gauge/specs/checkout.spec" },
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

  assert.equal(actions.length, 1);
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

  assert.equal(actions.length, 1);
  assert.deepEqual(actions[0].command, {
    command: GENERATE_STEP_STUB,
    title: CREATE_STEP_IMPLEMENTATION_TITLE,
    arguments: [
      "@com.thoughtworks.gauge.Step(\"Pay with account <table>\")\nfun implementation(arg0: Any) {\n}\n",
    ],
  });
});

test("GaugeStepCodeActionProvider avoids duplicate Kotlin step stub names", () => {
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

  assert.equal(actions.length, 1);
  assert.deepEqual(actions[0].command, {
    command: GENERATE_STEP_STUB,
    title: CREATE_STEP_IMPLEMENTATION_TITLE,
    arguments: [
      "@com.thoughtworks.gauge.Step(\"Refund <amount>\")\nfun implementation1(arg0: Any) {\n}\n",
    ],
  });
});
