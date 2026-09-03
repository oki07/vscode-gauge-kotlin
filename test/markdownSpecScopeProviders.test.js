const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

// Every provider registered for `**/*.md` must agree on whether a given Markdown
// file is a Gauge specification. Gauge reads Markdown as a specification only
// inside the directories named by gauge_specs_dir
// (getgauge/gauge/util/util.go GetSpecDirs), so a README or CHANGELOG in a
// Gauge project must get no Gauge decoration at all: no colouring, no folding,
// no outline, and above all no Run and Debug code lenses that would run Gauge
// against it.

const README = "/workspace/gauge/README.md";
const SPEC = "/workspace/gauge/specs/checkout.md";

const SPEC_TEXT = [
  "# Checkout",
  "",
  "## Successful checkout",
  "* Pay with card",
].join("\n");

function projectFactory() {
  return {
    isGaugeProject: () => true,
    getGaugeRootFromFilePath: (file) => (
      String(file).startsWith("/workspace/gauge/") ? "/workspace/gauge" : undefined
    ),
    get: () => ({ root: () => "/workspace/gauge", isProjectLanguage: () => true }),
  };
}

function fileSystem() {
  return {
    existsSync: () => false,
    readFileSync() {
      throw new Error("no project properties");
    },
  };
}

function createDocument(fsPath) {
  const text = SPEC_TEXT;
  return {
    languageId: "markdown",
    uri: { fsPath },
    fileName: fsPath,
    getText: () => text,
    get lineCount() {
      return text.split("\n").length;
    },
    lineAt(line) {
      return { text: text.split("\n")[line] };
    },
  };
}

function providerOptions(extra = {}) {
  return {
    fileSystem: fileSystem(),
    pathModule: path.posix,
    projectFactory: projectFactory(),
    ...extra,
  };
}

test("folding leaves a README in a Gauge project alone", () => {
  const { GaugeFoldingRangeProvider } = require("../src/foldingRangeProvider");
  const provider = new GaugeFoldingRangeProvider(providerOptions());

  assert.deepEqual(provider.provideFoldingRanges(createDocument(README)), []);
  assert.ok(provider.provideFoldingRanges(createDocument(SPEC)).length > 0);
});

test("the outline leaves a README in a Gauge project alone", () => {
  const { GaugeDocumentSymbolProvider } = require("../src/documentSymbolProvider");
  const provider = new GaugeDocumentSymbolProvider(providerOptions({
    vscode: {
      SymbolKind: { Namespace: 2, Method: 5, Field: 7 },
      Range: function Range(start, end) {
        this.start = start;
        this.end = end;
      },
      Position: function Position(line, character) {
        this.line = line;
        this.character = character;
      },
      SymbolInformation: function SymbolInformation(name, kind, containerName, location) {
        this.name = name;
        this.kind = kind;
        this.containerName = containerName;
        this.location = location;
      },
      DocumentSymbol: function DocumentSymbol(name, detail, kind, range, selectionRange) {
        this.name = name;
        this.detail = detail;
        this.kind = kind;
        this.range = range;
        this.selectionRange = selectionRange;
        this.children = [];
      },
      Uri: { file: (value) => ({ fsPath: value }) },
    },
  }));

  assert.deepEqual(provider.provideDocumentSymbols(createDocument(README)), []);
  assert.ok(provider.provideDocumentSymbols(createDocument(SPEC)).length > 0);
});

test("semantic tokens leave a README in a Gauge project alone", () => {
  const { GaugeSemanticTokensProvider, createLegend } = require("../src/semanticTokensProvider");
  const pushes = [];
  class SemanticTokensBuilder {
    constructor() {
      this.tokens = [];
    }

    push(...args) {
      this.tokens.push(args);
      pushes.push(args);
    }

    build() {
      return { data: this.tokens };
    }
  }
  const legend = createLegend({ SemanticTokensLegend: function Legend(types) { this.types = types; } });
  const provider = new GaugeSemanticTokensProvider(providerOptions({
    legend,
    SemanticTokensBuilder,
  }));

  provider.provideDocumentSemanticTokens(createDocument(README));
  assert.deepEqual(pushes, []);

  provider.provideDocumentSemanticTokens(createDocument(SPEC));
  assert.ok(pushes.length > 0);
});

test("code lenses leave a README in a Gauge project alone", () => {
  const { GaugeCodeLensProvider } = require("../src/codeLensProvider");
  const provider = new GaugeCodeLensProvider(providerOptions());

  assert.deepEqual(provider.provideCodeLenses(createDocument(README)), []);
  assert.ok(provider.provideCodeLenses(createDocument(SPEC)).length > 0);
});

// The command surface was the last place the gauge_specs_dir rule had not
// reached. Preview, Format, Toggle Gauge Line Comment and Extract to Concept all
// accepted any Markdown file in a Gauge project, so Format rewrote a README in
// place with `gauge format` and Toggle Comment inserted Gauge comment syntax into
// it, while the extension's own code lens and diagnostics were already suppressed
// on the same file.

test("Toggle Gauge Line Comment refuses a README in a Gauge project", () => {
  const { toggleGaugeLineComment } = require("../src/commentCommand");
  const edits = [];
  const vscode = {
    window: {
      activeTextEditor: { document: createDocument(README) },
      showErrorMessage() {},
      showInformationMessage() {},
    },
    workspace: {
      applyEdit(edit) {
        edits.push(edit);
        return Promise.resolve(true);
      },
    },
  };

  toggleGaugeLineComment(vscode, providerOptions());

  assert.deepEqual(edits, []);
});

// VS Code refuses a WorkspaceEdit whose document moved on under it and reports
// that by resolving applyEdit to false. Toggling silently in that case leaves
// the user staring at unchanged text, so say the edit was not applied. This is
// the same contract src/annotator/generateStub.js reportRefusedEdit already
// gives for the stub edits.
test("Toggle Gauge Line Comment reports a refused edit", async () => {
  const { toggleGaugeLineComment } = require("../src/commentCommand");
  const errors = [];
  const document = createDocument(SPEC);
  const vscode = {
    window: {
      activeTextEditor: {
        document,
        selection: { start: { line: 3, character: 0 }, end: { line: 3, character: 0 } },
      },
      showErrorMessage(message) {
        errors.push(message);
      },
      showInformationMessage() {},
    },
    workspace: {
      applyEdit: () => Promise.resolve(false),
    },
    WorkspaceEdit: class WorkspaceEdit {
      replace() {}
    },
  };

  await toggleGaugeLineComment(vscode, providerOptions());

  assert.deepEqual(errors, ["The edit was not applied."]);
});

test("Format refuses a README in a Gauge project", () => {
  const { GaugeFormatProvider } = require("../src/formatProvider");
  const provider = new GaugeFormatProvider(providerOptions({
    vscode: { workspace: { getConfiguration: () => ({ get: () => undefined }) }, window: {} },
  }));

  assert.equal(provider.shouldFormat(createDocument(README)), false);
  assert.equal(provider.shouldFormat(createDocument(SPEC)), true);
});
