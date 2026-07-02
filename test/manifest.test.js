const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

function readPackageJson() {
  const packagePath = path.join(root, "package.json");
  return JSON.parse(fs.readFileSync(packagePath, "utf8"));
}

function readReferencePackageJson() {
  const packagePath = path.join(root, "..", "references", "gauge-vscode", "package.json");
  return JSON.parse(fs.readFileSync(packagePath, "utf8"));
}

function readVscodeIgnore() {
  const ignorePath = path.join(root, ".vscodeignore");
  return fs.readFileSync(ignorePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function comparableConfigurationSchema(configuration) {
  return {
    type: configuration.type,
    default: configuration.default,
    enum: configuration.enum,
    description: configuration.description,
  };
}

function commandById(manifest, commandId) {
  return manifest.contributes.commands.find((entry) => entry.command === commandId);
}

function debuggerByType(manifest, type) {
  return manifest.contributes.debuggers.find((entry) => entry.type === type);
}

function grammarRegex(source) {
  let pattern = source;
  let flags = "u";
  if (pattern.startsWith("(?i)")) {
    pattern = pattern.slice("(?i)".length);
    flags += "i";
  }
  pattern = pattern.replaceAll("\\A", "^");
  return new RegExp(pattern, flags);
}

function repositoryPattern(grammar, key, index = 0) {
  const entry = grammar.repository[key];
  assert.ok(entry, `missing ${key}`);
  if (entry.patterns) {
    assert.ok(entry.patterns[index], `missing ${key} pattern ${index}`);
    return entry.patterns[index];
  }
  return entry;
}

function assertPatternMatches(pattern, text, expectedText = text) {
  const source = pattern.match || pattern.begin;
  assert.ok(source, "pattern must have match or begin");
  const match = grammarRegex(source).exec(text);
  assert.ok(match, `${source} should match ${text}`);
  assert.equal(match[0], expectedText);
}

function assertPatternDoesNotMatch(pattern, text) {
  const source = pattern.match || pattern.begin;
  assert.ok(source, "pattern must have match or begin");
  assert.equal(grammarRegex(source).test(text), false, `${source} should not match ${text}`);
}

function firstMatchingTopLevelPattern(grammar, text) {
  for (const include of grammar.patterns) {
    const key = include.include && include.include.replace(/^#/, "");
    const entry = key && grammar.repository[key];
    if (!entry) {
      continue;
    }
    const patterns = entry.match || entry.begin ? [entry] : (entry.patterns || [entry]);
    for (const pattern of patterns) {
      const source = pattern.match || pattern.begin;
      if (source && grammarRegex(source).test(text)) {
        return { include: include.include, pattern };
      }
    }
  }
  return undefined;
}

test("extension manifest exposes the core Gauge VS Code surface for Kotlin projects", () => {
  const manifest = readPackageJson();

  assert.equal(manifest.name, "vscode-gauge-kotlin");
  assert.equal(manifest.displayName, "Gauge Kotlin");
  assert.equal(manifest.main, "./src/extension.js");
  assert.equal(manifest.author, "oki07");
  assert.equal(manifest.publisher, "oki07");
  assert.deepEqual(manifest.repository, {
    type: "git",
    url: "https://github.com/oki07/vscode-gauge-kotlin.git",
  });
  assert.equal(manifest.icon, "images/gauge-icon.png");
  assert.deepEqual(manifest.galleryBanner, {
    color: "#F5C20F",
    theme: "light",
  });
  assert.deepEqual(manifest.scripts, {
    typecheck: "node scripts/check-js-syntax.js",
    lint: "node scripts/check-js-syntax.js",
    "test:unit": "node --test",
    "test:lsp": "node --test test/gaugeClients.test.js test/gaugeWorkspace.test.js",
    "test:vscode": "node --test test/extension.test.js test/manifest.test.js",
    package: "node scripts/package-vsix.js",
    check: "npm run typecheck && npm run lint && npm run test:unit && npm run test:lsp && npm run test:vscode && npm run package",
    test: "npm run test:unit",
  });
  assert.equal(manifest.dependencies["vscode-languageclient"], "~9.0.1");
  assert.deepEqual(manifest.categories, ["Programming Languages", "Testing"]);
  assert.equal(Object.hasOwn(manifest, "files"), false);
  assert.equal(fs.existsSync(path.join(root, "README.md")), true);
  assert.equal(fs.existsSync(path.join(root, "LICENSE")), true);
  assert.equal(fs.existsSync(path.join(root, "package-lock.json")), true);
  assert.equal(fs.existsSync(path.join(root, manifest.icon)), true);

  assert.deepEqual(manifest.activationEvents, [
    "onCommand:gauge.createProject",
    "onCommand:gauge.preview",
    "workspaceContains:manifest.json",
    "workspaceContains:**/manifest.json",
    "onLanguage:gauge",
    "onLanguage:kotlin",
    "onLanguage:java",
    "onDebugResolve:gauge",
  ]);

  const language = manifest.contributes.languages.find((entry) => entry.id === "gauge");
  assert.ok(language);
  assert.deepEqual(language.extensions, [".spec", ".cpt"]);
  assert.deepEqual(language.aliases, ["Gauge", "Specification", "Spec", "Concept"]);
  assert.equal(language.configuration, "./language-configuration.json");

  assert.deepEqual(manifest.contributes.iconThemes, [
    {
      id: "gauge-kotlin-icons",
      label: "Gauge Kotlin Icons",
      path: "./resources/gauge-icon-theme.json",
    },
  ]);
  const iconThemePath = path.join(root, manifest.contributes.iconThemes[0].path);
  const iconTheme = JSON.parse(fs.readFileSync(iconThemePath, "utf8"));
  assert.deepEqual(iconTheme.fileExtensions, {
    spec: "_gauge_spec",
    cpt: "_gauge_concept",
  });
  assert.deepEqual(iconTheme.languageIds, {
    gauge: "_gauge_spec",
  });
  assert.equal(
    iconTheme.iconDefinitions._gauge_spec.iconPath,
    "../images/gauge-icon.png",
  );
  assert.equal(
    iconTheme.iconDefinitions._gauge_concept.iconPath,
    "../images/gauge-icon.png",
  );
  for (const definition of Object.values(iconTheme.iconDefinitions)) {
    assert.equal(
      fs.existsSync(path.resolve(path.dirname(iconThemePath), definition.iconPath)),
      true,
    );
  }

  const commandIds = manifest.contributes.commands.map((entry) => entry.command);
  assert.deepEqual(commandIds, [
    "gauge.createProject",
    "gauge.create.specification",
    "gauge.create.concept",
    "gauge.extract.concept",
    "gauge.format",
    "gauge.toggle.lineComment",
    "gauge.preview",
    "gauge.config.saveRecommended",
    "gauge.stopExecution",
    "gauge.execute.failed",
    "gauge.report.html",
    "gauge.execute.repeat",
    "gauge.execute.specification",
    "gauge.execute.specification.all",
    "gauge.specexplorer.runAllActiveProjectSpecs",
    "gauge.specexplorer.runNode",
    "gauge.specexplorer.debugNode",
    "gauge.execute.scenario",
    "gauge.execute.scenarios",
    "gauge.showReferences.atCursor",
    "gauge.specexplorer.switchProject",
  ]);

  const commandPaletteIds = manifest.contributes.menus.commandPalette.map(
    (entry) => entry.command,
  );
  assert.ok(commandPaletteIds.includes("gauge.create.concept"));
  assert.ok(commandPaletteIds.includes("gauge.extract.concept"));
  assert.ok(commandPaletteIds.includes("gauge.format"));
  assert.ok(commandPaletteIds.includes("gauge.toggle.lineComment"));
  assert.ok(commandPaletteIds.includes("gauge.preview"));
  const markdownGaugeEditorWhen = "gauge:activated && (editorLangId == gauge || resourceExtname == .spec || (editorLangId == markdown && resourceExtname == .md))";
  const markdownGaugeSpecWhen = "gauge:activated && editorLangId == markdown && resourceExtname == .md";
  assert.equal(
    manifest.contributes.menus.commandPalette.find(
      (entry) => entry.command === "gauge.extract.concept",
    ).when,
    markdownGaugeEditorWhen,
  );
  assert.equal(
    manifest.contributes.menus.commandPalette.find(
      (entry) => entry.command === "gauge.format",
    ).when,
    markdownGaugeEditorWhen,
  );
  assert.equal(
    manifest.contributes.menus.commandPalette.find(
      (entry) => entry.command === "gauge.toggle.lineComment",
    ).when,
    markdownGaugeSpecWhen,
  );
  assert.equal(commandById(manifest, "gauge.preview").icon, "$(open-preview)");
  assert.deepEqual(manifest.contributes.keybindings, [
    {
      command: "gauge.format",
      key: "ctrl+alt+shift+l",
      when: "editorTextFocus && (editorLangId == gauge || resourceExtname == .spec || (editorLangId == markdown && resourceExtname == .md))",
    },
    {
      command: "gauge.extract.concept",
      key: "ctrl+alt+c",
      when: "editorTextFocus && (editorLangId == gauge || resourceExtname == .spec || (editorLangId == markdown && resourceExtname == .md))",
    },
    {
      command: "gauge.toggle.lineComment",
      key: "ctrl+/",
      mac: "cmd+/",
      when: "editorTextFocus && editorLangId == markdown && resourceExtname == .md && gauge:activated",
    },
  ]);
  assert.deepEqual(manifest.contributes.menus["explorer/context"], [
    {
      command: "gauge.create.specification",
      when: "gauge:activated && explorerResourceIsFolder",
      group: "gauge@1",
    },
    {
      command: "gauge.create.concept",
      when: "gauge:activated && explorerResourceIsFolder",
      group: "gauge@2",
    },
    {
      command: "gauge.execute.specification",
      when: "gauge:activated && (explorerResourceIsFolder || resourceExtname == .spec || resourceExtname == .md)",
      group: "gauge@3",
    },
  ]);
  assert.deepEqual(manifest.contributes.menus["editor/title"], [
    {
      command: "gauge.preview",
      when: "gauge:activated && (editorLangId == gauge || resourceExtname == .spec || (editorLangId == markdown && resourceExtname == .md))",
      group: "navigation@10",
    },
  ]);
  assert.deepEqual(manifest.contributes.menus["editor/context"], [
    {
      command: "gauge.preview",
      when: "gauge:activated && (editorLangId == gauge || resourceExtname == .spec || (editorLangId == markdown && resourceExtname == .md))",
      group: "navigation@10",
    },
    {
      command: "gauge.extract.concept",
      when: "gauge:activated && (editorLangId == gauge || resourceExtname == .spec || (editorLangId == markdown && resourceExtname == .md))",
      group: "1_modification",
    },
    {
      command: "gauge.format",
      when: "gauge:activated && (editorLangId == gauge || resourceExtname == .spec || (editorLangId == markdown && resourceExtname == .md))",
      group: "1_modification",
    },
    {
      command: "gauge.toggle.lineComment",
      when: "gauge:activated && editorLangId == markdown && resourceExtname == .md",
      group: "1_modification",
    },
  ]);

  const configuration = manifest.contributes.configuration.properties;
  assert.deepEqual(configuration["gauge.executablePath"], {
    type: "string",
    default: "",
    description: "Path to the Gauge executable. Leave empty to use Gauge from PATH.",
  });
  assert.deepEqual(configuration["gauge.home"], {
    type: "string",
    default: "",
    description: "Path to GAUGE_HOME. Leave empty to use the process environment or Gauge default.",
  });
  assert.equal(configuration["gauge.specExplorer.enabled"].default, true);
  assert.equal(configuration["gauge.execution.debugPort"].default, 9229);
  assert.equal(configuration["gauge.codeLenses.reference"].default, true);
  assert.equal(configuration["gauge.kotlin.template"].default, "gradle");
  assert.deepEqual(configuration["gauge.semanticTokenColors.dynamicArgument"], {
    type: "string",
    default: "#ae81ff",
    description: "Color for dynamic arguments.",
  });
  assert.deepEqual(configuration["gauge.semanticTokenColors.tableHeader"], {
    type: "string",
    default: "#ae81ff",
    description: "Color for table headers.",
  });

  const debuggerContribution = manifest.contributes.debuggers.find(
    (entry) => entry.type === "gauge",
  );
  assert.ok(debuggerContribution);
  assert.deepEqual(
    debuggerContribution.configurationAttributes.test.properties,
    {
      args: {
        description: "[Gauge] Additional Gauge command-line arguments.",
        type: "array",
        items: {
          type: "string",
        },
        default: [],
      },
      cwd: {
        description: "[Gauge] Process working directory. Relative paths are resolved from the Gauge project root.",
        type: "string",
        default: "",
      },
      env: {
        description: "[Gauge] Specifies the environment to use (default \"default\")",
        type: "array",
        items: {
          type: "string",
        },
        default: [],
      },
      "fail-safe": {
        description: "[Gauge] Force return 0 exit code, even in case of failures.",
        type: "boolean",
        default: false,
      },
      failed: {
        description: "[Gauge] Run only the scenarios failed in previous run. This cannot be used in conjunction with any other argument",
        type: "boolean",
        default: false,
      },
      group: {
        description: "[Gauge] Specify which group of specification to execute based on -n flag (default -1)",
        type: "number",
        default: -1,
      },
      "hide-suggestion": {
        description: "[Gauge] Hide step implementation stub for every unimplemented step",
        type: "boolean",
        default: false,
      },
      "install-plugins": {
        description: "[Gauge] Install All Missing Plugins (default true)",
        type: "boolean",
        default: true,
      },
      "max-retries-count": {
        description: "[Gauge] Max count of iterations for failed scenario (default 1)",
        type: "number",
        default: 1,
      },
      n: {
        description: "[Gauge] Specify number of parallel execution streams (default 8)",
        type: "number",
        default: 8,
      },
      parallel: {
        description: "[Gauge] Execute specs in parallel",
        type: "boolean",
        default: false,
      },
      repeat: {
        description: "[Gauge] Repeat last run. This cannot be used in conjunction with any other argument",
        type: "boolean",
        default: false,
      },
      "retry-only": {
        description: "[Gauge] Retries the specs and scenarios tagged with given tags",
        type: "string",
        default: "",
      },
      scenario: {
        description: "[Gauge] Set scenarios for running specs with scenario name",
        type: "array",
        items: {
          type: "string",
        },
        default: [],
      },
      "simple-console": {
        description: "[Gauge] Removes colouring and simplifies the console output",
        type: "boolean",
        default: false,
      },
      sort: {
        description: "[Gauge] Run specs in Alphabetical Order",
        type: "boolean",
        default: false,
      },
      strategy: {
        description: "[Gauge] Set the parallelization strategy for execution. Possible options are: eager,lazy (default \"lazy\")",
        enum: [
          "eager",
          "lazy",
        ],
        default: "lazy",
      },
      "table-rows": {
        description: "[Gauge] Executes the specs and scenarios only for the selected rows. It can be specified by range as 2_4 or as list 2,4",
        type: "string",
        default: "",
      },
      tags: {
        description: "[Gauge] Executes the specs and scenarios tagged with given tags",
        type: "string",
        default: "",
      },
      verbose: {
        description: "[Gauge] Enable step level reporting on console, default being scenario level",
        type: "boolean",
        default: false,
      },
      dir: {
        description: "[Gauge] Set the working directory for the current command, accepts a path relative to current directory (default \".\")",
        type: "string",
        default: ".",
      },
      "log-level": {
        description: "[Gauge] Set level of logging to debug, info, warning, error or critical (default \"info\")",
        enum: [
          "debug",
          "info",
          "warning",
          "error",
          "critical",
        ],
        default: "info",
      },
      "machine-readable": {
        description: "[Gauge] Prints output in JSON format",
        type: "boolean",
        default: false,
      },
      processEnv: {
        description: "[Gauge] Environment variables for the Gauge process.",
        type: "object",
        additionalProperties: {
          type: "string",
        },
        default: {},
      },
    },
  );
  assert.deepEqual(debuggerContribution.initialConfigurations, [
    {
      name: "Gauge Run Option",
      type: "gauge",
      request: "test",
    },
  ]);

  const grammar = manifest.contributes.grammars.find((entry) => entry.language === "gauge");
  assert.ok(grammar);
  assert.equal(grammar.scopeName, "text.gauge");
  assert.equal(grammar.path, "./syntaxes/gauge.tmLanguage.json");

  assert.deepEqual(manifest.contributes.snippets, [
    {
      language: "gauge",
      path: "./snippets/gauge.json",
    },
    {
      language: "markdown",
      path: "./snippets/gauge.json",
    },
  ]);

  for (const relativePath of [
    manifest.main,
    language.configuration,
    grammar.path,
    manifest.contributes.snippets[0].path,
  ]) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), true, relativePath);
  }

  const languageConfiguration = JSON.parse(
    fs.readFileSync(path.join(root, language.configuration), "utf8"),
  );
  assert.deepEqual(languageConfiguration, {
    comments: {
      lineComment: "//",
    },
    brackets: [
      ["<", ">"],
      ["\"", "\""],
    ],
    autoClosingPairs: [
      ["<", ">"],
      ["\"", "\""],
    ],
    surroundingPairs: [
      ["<", ">"],
      ["\"", "\""],
    ],
  });

  const snippets = JSON.parse(
    fs.readFileSync(path.join(root, manifest.contributes.snippets[0].path), "utf8"),
  );
  const snippetPrefixes = Object.values(snippets).map((entry) => entry.prefix);
  assert.deepEqual(snippetPrefixes, [
    "spec",
    "spec",
    "sce",
    "sce",
    "cpt",
    "table:1",
    "table:2",
    "table:3",
    "table:4",
    "table:5",
    "table:6",
  ]);
  assert.deepEqual(snippets.Specification.body, [
    "# ${1:SPECIFICATION_HEADING}",
    "$0",
  ]);
  assert.deepEqual(snippets["Legacy Specification"].body, [
    "${1:SPECIFICATION_HEADING}",
    "=====================",
    "$0",
  ]);
  assert.deepEqual(snippets.Scenario.body, [
    "## ${1:Scenario Heading}",
    "* $0",
  ]);
  assert.deepEqual(snippets["Legacy Scenario"].body, [
    "${1:SCENARIO_HEADING}",
    "----------------",
    "$0",
  ]);
  assert.deepEqual(snippets.Concept.body, [
    "# ${1:Concept Heading}",
    "* $0",
  ]);
  assert.deepEqual(snippets["Table with two columns"].body, [
    "|${1:HEADER}|${2:HEADER}|",
    "|------|------|",
    "|${3:value}|${4:value}|",
    "|${5:value}|${6:value}$0|",
  ]);
  assert.deepEqual(snippets["Table with six columns"].body, [
    "|${1:HEADER}|${2:HEADER}|${3:HEADER}|${4:HEADER}|${5:HEADER}|${6:HEADER}|",
    "|------|------|------|------|------|------|",
    "|${7:value}|${8:value}|${9:value}|${10:value}|${11:value}|${12:value}|",
    "|${13:value}|${14:value}|${15:value}|${16:value}|${17:value}|${18:value}$0|",
  ]);
});

test("extension manifest contributes a Gauge TextMate grammar", () => {
  const manifest = readPackageJson();
  const grammar = manifest.contributes.grammars.find((entry) => entry.language === "gauge");

  assert.deepEqual(grammar, {
    language: "gauge",
    scopeName: "text.gauge",
    path: "./syntaxes/gauge.tmLanguage.json",
  });

  const grammarJson = JSON.parse(fs.readFileSync(path.join(root, grammar.path), "utf8"));
  assert.equal(grammarJson.scopeName, "text.gauge");
  assert.deepEqual(
    grammarJson.patterns.map((entry) => entry.include),
    [
      "#frontMatter",
      "#comments",
      "#tags",
      "#tableKeyword",
      "#specHeading",
      "#scenarioHeading",
      "#conceptHeading",
      "#step",
      "#teardown",
      "#table",
      "#arguments",
      "#markdown",
      "#fallbackComment",
    ],
  );
  for (const key of [
    "comments",
    "frontMatter",
    "tags",
    "tableKeyword",
    "specHeading",
    "scenarioHeading",
    "conceptHeading",
    "step",
    "teardown",
    "table",
    "tableSeparator",
    "tableRow",
    "arguments",
    "tableArguments",
    "markdown",
    "markdownBlockquote",
    "markdownAutoLink",
    "markdownFencedCode",
    "markdownHtmlBlock",
    "markdownImage",
    "markdownInline",
    "markdownJavaFencedCode",
    "markdownJavaScriptFencedCode",
    "markdownJsonFencedCode",
    "markdownKotlinFencedCode",
    "markdownLink",
    "markdownLinkDefinition",
    "markdownList",
    "markdownPythonFencedCode",
    "markdownReferenceImage",
    "markdownReferenceLink",
    "markdownSeparator",
    "markdownShellFencedCode",
    "markdownYamlFencedCode",
    "fallbackComment",
  ]) {
    assert.ok(grammarJson.repository[key], `missing ${key}`);
  }
});

test("Gauge TextMate grammar follows Gauge lexer line starts and keywords", () => {
  const manifest = readPackageJson();
  const grammar = manifest.contributes.grammars.find((entry) => entry.language === "gauge");
  const grammarJson = JSON.parse(fs.readFileSync(path.join(root, grammar.path), "utf8"));

  assertPatternMatches(grammarJson.repository.tags, "TAGS : smoke", "TAGS : ");
  assertPatternMatches(grammarJson.repository.tableKeyword, "Table : users.csv", "Table : ");

  assertPatternMatches(repositoryPattern(grammarJson, "specHeading", 0), "#Title", "#");
  assertPatternMatches(repositoryPattern(grammarJson, "scenarioHeading", 0), "##Scenario");
  assertPatternDoesNotMatch(repositoryPattern(grammarJson, "scenarioHeading", 0), "### Notes");
  assertPatternMatches(repositoryPattern(grammarJson, "specHeading", 1), "=", "=");
  assertPatternMatches(repositoryPattern(grammarJson, "scenarioHeading", 1), "-", "-");

  assertPatternMatches(grammarJson.repository.step, "* do something", "* ");
  assertPatternDoesNotMatch(grammarJson.repository.step, "  * plain comment");
  assertPatternMatches(grammarJson.repository.teardown, "___", "___");
  assertPatternMatches(grammarJson.repository.teardown, "___  ", "___  ");
  assertPatternMatches(grammarJson.repository.tableRow, "| name |", "|");
  assertPatternMatches(grammarJson.repository.tableRow, "  | table cell |", "  |");
  assertPatternMatches(grammarJson.repository.tableSeparator, "  |---|", "  |");
});

test("Gauge TextMate grammar keeps trailing-comma tag continuations as tag values", () => {
  const manifest = readPackageJson();
  const grammar = manifest.contributes.grammars.find((entry) => entry.language === "gauge");
  const grammarJson = JSON.parse(fs.readFileSync(path.join(root, grammar.path), "utf8"));
  const tags = grammarJson.repository.tags;
  const tagValue = repositoryPattern(grammarJson, "tags", 0);
  const tagEnd = { match: tags.end };

  assertPatternMatches(tags, "tags: smoke,", "tags: ");
  assertPatternMatches(tagValue, "smoke,", "smoke");
  assertPatternDoesNotMatch(tagEnd, "smoke,");
  assertPatternDoesNotMatch(tagEnd, "smoke,   ");
  assertPatternMatches(tagEnd, "fast", "");
});

test("Gauge TextMate grammar handles table and argument lexer edge cases", () => {
  const manifest = readPackageJson();
  const grammar = manifest.contributes.grammars.find((entry) => entry.language === "gauge");
  const grammarJson = JSON.parse(fs.readFileSync(path.join(root, grammar.path), "utf8"));
  const dynamicArgument = repositoryPattern(grammarJson, "arguments", 0);
  const tableDynamicArgument = repositoryPattern(grammarJson, "tableArguments", 0);
  const tableSeparatorPipe = repositoryPattern(grammarJson, "tableRow", 0);
  const fallbackComment = grammarJson.repository.fallbackComment;

  assertPatternMatches(dynamicArgument, "<name \\> suffix>", "<name \\> suffix>");
  assertPatternMatches(dynamicArgument, "<>", "<>");
  assertPatternMatches(tableDynamicArgument, "<user>", "<user>");
  assertPatternDoesNotMatch(tableDynamicArgument, "<user | admin>");
  assertPatternMatches(tableSeparatorPipe, "|", "|");
  assertPatternDoesNotMatch(tableSeparatorPipe, "\\|");
  assertPatternMatches(fallbackComment, "plain comment");
  assert.equal(firstMatchingTopLevelPattern(grammarJson, "___").include, "#teardown");
  assert.notEqual(firstMatchingTopLevelPattern(grammarJson, "___").include, "#markdown");
});

test("Gauge TextMate grammar keeps only dynamic arguments reachable in hash concept headings", () => {
  const manifest = readPackageJson();
  const grammar = manifest.contributes.grammars.find((entry) => entry.language === "gauge");
  const grammarJson = JSON.parse(fs.readFileSync(path.join(root, grammar.path), "utf8"));

  const firstMatch = firstMatchingTopLevelPattern(grammarJson, "# Shared checkout <item> \"card\"");

  assert.ok(firstMatch, "hash heading should match a top-level pattern");
  assert.deepEqual(firstMatch.pattern.patterns, [{ include: "#dynamicArguments" }]);
  assertPatternMatches(repositoryPattern(grammarJson, "dynamicArguments", 0), "<item>");
  assertPatternDoesNotMatch(repositoryPattern(grammarJson, "dynamicArguments", 0), "\"card\"");
});

test("Gauge TextMate grammar preserves common Markdown constructs", () => {
  const manifest = readPackageJson();
  const grammar = manifest.contributes.grammars.find((entry) => entry.language === "gauge");
  const grammarJson = JSON.parse(fs.readFileSync(path.join(root, grammar.path), "utf8"));
  const markdownBlockquote = repositoryPattern(grammarJson, "markdownBlockquote");
  const markdownAutoLink = repositoryPattern(grammarJson, "markdownAutoLink");
  const markdownFence = repositoryPattern(grammarJson, "markdownFencedCode");
  const markdownHtmlBlock = grammarJson.repository.markdownHtmlBlock;
  const markdownImage = repositoryPattern(grammarJson, "markdownImage");
  const markdownJavaFence = grammarJson.repository.markdownJavaFencedCode;
  const markdownJavaScriptFence = grammarJson.repository.markdownJavaScriptFencedCode;
  const markdownJsonFence = grammarJson.repository.markdownJsonFencedCode;
  const markdownKotlinFence = grammarJson.repository.markdownKotlinFencedCode;
  const markdownPythonFence = grammarJson.repository.markdownPythonFencedCode;
  const markdownReferenceImage = repositoryPattern(grammarJson, "markdownReferenceImage");
  const markdownReferenceLink = repositoryPattern(grammarJson, "markdownReferenceLink");
  const markdownShellFence = grammarJson.repository.markdownShellFencedCode;
  const markdownYamlFence = grammarJson.repository.markdownYamlFencedCode;
  const frontMatter = grammarJson.repository.frontMatter;
  const markdownLinkDefinition = repositoryPattern(grammarJson, "markdownLinkDefinition");
  const markdownList = repositoryPattern(grammarJson, "markdownList");
  const markdownLink = repositoryPattern(grammarJson, "markdownLink");
  const markdownSeparator = repositoryPattern(grammarJson, "markdownSeparator");

  assert.deepEqual(grammarJson.repository.markdown.patterns.map((entry) => entry.include), [
    "#markdownBlockquote",
    "#markdownSeparator",
    "#markdownKotlinFencedCode",
    "#markdownJavaFencedCode",
    "#markdownJavaScriptFencedCode",
    "#markdownJsonFencedCode",
    "#markdownPythonFencedCode",
    "#markdownShellFencedCode",
    "#markdownYamlFencedCode",
    "#markdownFencedCode",
    "#markdownLinkDefinition",
    "#markdownHtmlBlock",
    "#markdownList",
    "#markdownInline",
  ]);
  assertPatternMatches(markdownJavaFence, "```java", "```java");
  assertPatternMatches(markdownJavaFence, "~~~bsh", "~~~bsh");
  assert.equal(markdownJavaFence.contentName, "meta.embedded.block.java");
  assert.deepEqual(markdownJavaFence.patterns, [{ include: "source.java" }]);
  assertPatternMatches(markdownKotlinFence, "```kotlin", "```kotlin");
  assertPatternMatches(markdownKotlinFence, "~~~kt", "~~~kt");
  assertPatternMatches(markdownKotlinFence, "```kts", "```kts");
  assert.equal(markdownKotlinFence.contentName, "meta.embedded.block.kotlin");
  assert.deepEqual(markdownKotlinFence.patterns, [{ include: "source.kotlin" }]);
  assertPatternMatches(markdownJavaScriptFence, "```js", "```js");
  assertPatternMatches(markdownJavaScriptFence, "~~~javascript", "~~~javascript");
  assert.equal(markdownJavaScriptFence.contentName, "meta.embedded.block.javascript");
  assert.deepEqual(markdownJavaScriptFence.patterns, [{ include: "source.js" }]);
  assertPatternMatches(markdownJsonFence, "```json", "```json");
  assert.equal(markdownJsonFence.contentName, "meta.embedded.block.json");
  assert.deepEqual(markdownJsonFence.patterns, [{ include: "source.json" }]);
  assertPatternMatches(markdownPythonFence, "```python", "```python");
  assertPatternMatches(markdownPythonFence, "~~~py", "~~~py");
  assert.equal(markdownPythonFence.contentName, "meta.embedded.block.python");
  assert.deepEqual(markdownPythonFence.patterns, [{ include: "source.python" }]);
  assertPatternMatches(markdownShellFence, "```bash", "```bash");
  assertPatternMatches(markdownShellFence, "~~~zsh", "~~~zsh");
  assert.equal(markdownShellFence.contentName, "meta.embedded.block.shell");
  assert.deepEqual(markdownShellFence.patterns, [{ include: "source.shell" }]);
  assertPatternMatches(markdownYamlFence, "```yaml", "```yaml");
  assertPatternMatches(markdownYamlFence, "~~~yml", "~~~yml");
  assert.equal(markdownYamlFence.contentName, "meta.embedded.block.yaml");
  assert.deepEqual(markdownYamlFence.patterns, [{ include: "source.yaml" }]);
  assertPatternMatches(markdownFence, "```kotlin", "```kotlin");
  assertPatternMatches(markdownFence, "~~~", "~~~");
  assertPatternMatches(markdownList, "- markdown item", "- ");
  assertPatternMatches(markdownList, "1. markdown item", "1. ");
  assertPatternMatches(markdownBlockquote, "> quoted note", "> ");
  assertPatternMatches(markdownLink, "See [Gauge](https://gauge.org)", "[Gauge](https://gauge.org)");
  assertPatternMatches(markdownLinkDefinition, "[docs]: https://docs.gauge.org", "[docs]: https://docs.gauge.org");
  assertPatternMatches(markdownImage, "![Gauge](images/logo.png)", "![Gauge](images/logo.png)");
  assertPatternMatches(markdownReferenceLink, "See [Gauge][docs]", "[Gauge][docs]");
  assertPatternMatches(markdownReferenceImage, "![Gauge][logo]", "![Gauge][logo]");
  assertPatternMatches(markdownAutoLink, "<https://gauge.org>", "<https://gauge.org>");
  assertPatternMatches(markdownAutoLink, "<help@example.com>", "<help@example.com>");
  assertPatternMatches(markdownSeparator, "---", "---");
  assertPatternMatches(markdownHtmlBlock, "<details>", "<details>");
  assert.deepEqual(markdownHtmlBlock.patterns, [{ include: "text.html.basic" }]);
  assertPatternMatches(frontMatter, "---", "---");
  assert.equal(frontMatter.contentName, "meta.embedded.block.frontmatter");
  assert.equal(frontMatter.while, "^(?!(-{3}|\\.{3})\\s*$)");
  assert.deepEqual(frontMatter.patterns, [{ include: "source.yaml" }]);
});

test("extension package ignores development-only files while keeping runtime sources", () => {
  const manifest = readPackageJson();
  const ignored = readVscodeIgnore();

  assert.equal(Object.hasOwn(manifest, "files"), false);

  for (const pattern of [
    ".vscode/**",
    ".git/**",
    ".gitignore",
    "**/*.vsix",
    "**/*.zip",
    "**/*.tgz",
    "test/**",
    ".vscode-test/**",
    "docs/**",
    "scripts/**",
    "package-lock.json",
  ]) {
    assert.ok(ignored.includes(pattern), `missing ${pattern}`);
  }

  for (const runtimePattern of [
    "src/**",
    "resources/**",
    "snippets/**",
    "syntaxes/**",
    "language-configuration.json",
    "package.json",
    "node_modules",
  ]) {
    assert.ok(!ignored.includes(runtimePattern), `runtime pattern must stay packaged: ${runtimePattern}`);
  }
});

test("extension package script requires repository metadata", () => {
  const packageScript = fs.readFileSync(path.join(root, "scripts", "package-vsix.js"), "utf8");

  assert.equal(packageScript.includes("--allow-missing-repository"), false);
});

test("extension manifest preserves the official Gauge configuration schema", () => {
  const manifest = readPackageJson();
  const referenceManifest = readReferencePackageJson();
  const configuration = manifest.contributes.configuration.properties;
  const referenceConfiguration = referenceManifest.contributes.configuration.properties;
  const sharedKeys = Object.keys(referenceConfiguration).filter((key) => configuration[key]);

  assert.deepEqual(
    Object.fromEntries(
      sharedKeys.map((key) => [key, comparableConfigurationSchema(configuration[key])]),
    ),
    Object.fromEntries(
      sharedKeys.map((key) => [
        key,
        comparableConfigurationSchema(referenceConfiguration[key]),
      ]),
    ),
  );
});

test("extension manifest preserves official spec explorer command icons", () => {
  const manifest = readPackageJson();
  const referenceManifest = readReferencePackageJson();

  for (const commandId of [
    "gauge.specexplorer.runAllActiveProjectSpecs",
    "gauge.specexplorer.switchProject",
  ]) {
    const command = commandById(manifest, commandId);
    const referenceCommand = commandById(referenceManifest, commandId);

    assert.deepEqual(command.icon, referenceCommand.icon);
    assert.equal(fs.existsSync(path.join(root, command.icon.light)), true, command.icon.light);
    assert.equal(fs.existsSync(path.join(root, command.icon.dark)), true, command.icon.dark);
  }
});

test("extension manifest preserves official debugger configuration snippets", () => {
  const manifest = readPackageJson();
  const referenceManifest = readReferencePackageJson();

  assert.deepEqual(
    debuggerByType(manifest, "gauge").configurationSnippets,
    debuggerByType(referenceManifest, "gauge").configurationSnippets,
  );
});
