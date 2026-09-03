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

function assertPatternMatchesAt(pattern, text, expectedIndex, expectedText = "") {
  const source = pattern.match || pattern.begin;
  assert.ok(source, "pattern must have match or begin");
  const match = grammarRegex(source).exec(text);
  assert.ok(match, `${source} should match ${text}`);
  assert.equal(match.index, expectedIndex);
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

function legacyTableSnippetBody(columnCount) {
  const headerLine = Array.from({ length: columnCount }, (_, index) => `\${${index + 1}:HEADER}`)
    .join("|");
  const firstValueLine = Array.from({ length: columnCount }, (_, index) => (
    `\${${columnCount + index + 1}:value}`
  )).join("|");
  const secondValueLine = Array.from({ length: columnCount }, (_, index) => {
    const placeholder = `\${${columnCount * 2 + index + 1}:value}`;
    return index === columnCount - 1 ? `${placeholder}$0` : placeholder;
  }).join("|");
  return [
    "",
    `    |${headerLine}|`,
    `    |${firstValueLine}|`,
    `    |${secondValueLine}|`,
  ];
}

test("extension manifest exposes the core Gauge VS Code surface for Kotlin projects", () => {
  const manifest = readPackageJson();

  assert.equal(manifest.name, "vscode-gauge-kotlin");
  assert.equal(manifest.displayName, "Gauge Kotlin");
  assert.equal(manifest.main, "./out/extension.js");
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
    "benchmark:step-parser": "node --expose-gc scripts/benchmark-step-parser.js",
    "benchmark:workspace-index": "node scripts/benchmark-workspace-step-index.js",
    bundle: "node scripts/build-extension.js",
    // main is ./out/extension.js and out/ is gitignored, so a plain
    // `vsce package` or `vsce publish` would ship a stale or missing bundle
    // without this hook. `npm run package` builds it explicitly as well.
    "vscode:prepublish": "npm run bundle",
    // Correctness rules, not style: the gate has to be able to fail on an
    // undeclared identifier or a duplicated key, which a syntax parse cannot see.
    lint: "eslint .",
    "test:unit": "node --test",
    "test:lsp": "node --test test/gaugeClients.test.js test/gaugeWorkspace.test.js",
    "test:vscode": "node --test test/extension.test.js test/manifest.test.js",
    // The integration suite needs the real Gauge CLI and a real Gradle build, so
    // it stays out of `check`, which runs on the project's own dependencies.
    "test:integration": "node scripts/integration-test.js",
    package: "node scripts/package-vsix.js",
    check: "npm run lint && npm run test:unit && npm run test:lsp && npm run test:vscode && npm run package",
    test: "npm run test:unit",
  });
  assert.equal(manifest.dependencies["vscode-languageclient"], "~9.0.1");
  assert.equal(typeof manifest.devDependencies.esbuild, "string");
  assert.equal(typeof manifest.devDependencies.eslint, "string");
  assert.deepEqual(manifest.categories, ["Programming Languages", "Testing"]);
  assert.equal(Object.hasOwn(manifest, "files"), false);
  assert.equal(fs.existsSync(path.join(root, "README.md")), true);
  assert.equal(fs.existsSync(path.join(root, "LICENSE")), true);
  assert.equal(fs.existsSync(path.join(root, "package-lock.json")), true);
  assert.equal(fs.existsSync(path.join(root, manifest.icon)), true);

  // "workspaceContains:manifest.json" matches the workspace root only. This
  // extension discovers nested Gauge projects, and a Markdown specification has
  // no language of its own, so opening only a .md spec in a workspace whose
  // manifest sits one directory down activated nothing at all.
  assert.deepEqual(manifest.activationEvents, [
    "onCommand:gauge.createProject",
    "onCommand:gauge.preview",
    "workspaceContains:manifest.json",
    "workspaceContains:**/manifest.json",
    "onLanguage:gauge",
    "onLanguage:gauge-concept",
    "onLanguage:kotlin",
    "onLanguage:java",
    "onDebugResolve:gauge",
  ]);

  const language = manifest.contributes.languages.find((entry) => entry.id === "gauge");
  assert.ok(language);
  assert.deepEqual(language.extensions, [".spec"]);
  assert.deepEqual(language.aliases, ["Gauge", "Specification", "Spec"]);
  assert.equal(language.configuration, "./language-configuration.json");
  assert.deepEqual(language.icon, {
    light: "./images/gauge-file-light.svg",
    dark: "./images/gauge-file-dark.svg",
  });
  const conceptLanguage = manifest.contributes.languages.find((entry) => entry.id === "gauge-concept");
  assert.ok(conceptLanguage);
  assert.deepEqual(conceptLanguage.extensions, [".cpt"]);
  assert.deepEqual(conceptLanguage.aliases, ["Gauge Concept", "Concept"]);
  assert.equal(conceptLanguage.configuration, "./language-configuration.json");
  assert.deepEqual(conceptLanguage.icon, {
    light: "./images/gauge-file-light.svg",
    dark: "./images/gauge-file-dark.svg",
  });
  for (const iconPath of Object.values(language.icon)) {
    assert.equal(fs.existsSync(path.join(root, iconPath)), true);
  }
  for (const iconPath of Object.values(conceptLanguage.icon)) {
    assert.equal(fs.existsSync(path.join(root, iconPath)), true);
  }

  // No file icon theme is contributed. A VS Code icon theme owns every icon in
  // the Explorer, so a theme that defines only spec and cpt icons leaves every
  // other file and folder blank the moment a user selects it. The Gauge file
  // icons ship through the language contributions above instead, which apply
  // without taking the rest of the Explorer over.
  assert.equal(manifest.contributes.iconThemes, undefined);
  assert.equal(fs.existsSync(path.join(root, "resources", "gauge-icon-theme.json")), false);

  const commandIds = manifest.contributes.commands.map((entry) => entry.command);
  assert.deepEqual(commandIds, [
    "gauge.createProject",
    "gauge.create.specification",
    "gauge.create.concept",
    "gauge.extract.concept",
    "gauge.format",
    "gauge.toggle.lineComment",
    "gauge.preview",
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

  // `when` is not a field of a commands contribution, so VS Code ignores it
  // there; references/gauge-vscode/package.json carries one on this command and
  // it has never had an effect. `enablement` is the field that exists, and
  // gauge:executing is already maintained by src/execution/executor.js.
  assert.equal(commandById(manifest, "gauge.stopExecution").when, undefined);
  assert.equal(commandById(manifest, "gauge.stopExecution").enablement, "gauge:executing");
  for (const command of manifest.contributes.commands) {
    assert.equal(command.when, undefined, `${command.command} declares an inert when clause`);
  }

  const commandPaletteIds = manifest.contributes.menus.commandPalette.map(
    (entry) => entry.command,
  );
  assert.ok(commandPaletteIds.includes("gauge.create.concept"));
  assert.ok(commandPaletteIds.includes("gauge.extract.concept"));
  assert.ok(commandPaletteIds.includes("gauge.format"));
  assert.ok(commandPaletteIds.includes("gauge.toggle.lineComment"));
  assert.ok(commandPaletteIds.includes("gauge.preview"));
  const gaugeEditorWhen = "gauge:activated && (editorLangId == gauge || editorLangId == gauge-concept || resourceExtname == .spec || resourceExtname == .cpt || (editorLangId == markdown && resourceExtname == .md))";
  const gaugeEditorTextFocusWhen = "editorTextFocus && (editorLangId == gauge || editorLangId == gauge-concept || resourceExtname == .spec || resourceExtname == .cpt || (editorLangId == markdown && resourceExtname == .md))";
  const activatedGaugeEditorTextFocusWhen = `${gaugeEditorTextFocusWhen} && gauge:activated`;
  assert.equal(
    manifest.contributes.menus.commandPalette.find(
      (entry) => entry.command === "gauge.extract.concept",
    ).when,
    gaugeEditorWhen,
  );
  assert.equal(
    manifest.contributes.menus.commandPalette.find(
      (entry) => entry.command === "gauge.format",
    ).when,
    gaugeEditorWhen,
  );
  assert.equal(
    manifest.contributes.menus.commandPalette.find(
      (entry) => entry.command === "gauge.toggle.lineComment",
    ).when,
    gaugeEditorWhen,
  );
  assert.equal(commandById(manifest, "gauge.preview").icon, "$(open-preview)");
  // gauge.format, gauge.extract.concept and gauge.toggle.lineComment are all
  // registered only once Gauge services start, so all three keybindings carry
  // the same gauge:activated gate. Without it a keystroke resolves to a command
  // that does not exist and VS Code reports "command not found".
  assert.deepEqual(manifest.contributes.keybindings, [
    {
      command: "gauge.format",
      key: "ctrl+alt+shift+l",
      when: activatedGaugeEditorTextFocusWhen,
    },
    {
      command: "gauge.extract.concept",
      key: "ctrl+alt+c",
      when: activatedGaugeEditorTextFocusWhen,
    },
    {
      command: "gauge.toggle.lineComment",
      key: "ctrl+/",
      mac: "cmd+/",
      when: activatedGaugeEditorTextFocusWhen,
    },
  ]);
  assert.equal(gaugeEditorTextFocusWhen.length > 0, true);
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
      // No `.md` arm: a when-clause cannot read gauge_specs_dir, so the entry
      // cannot tell a specification from a README, and running a README parses
      // the prose as a specification. references/gauge-vscode contributes no
      // explorer/context menu at all.
      when: "gauge:activated && (explorerResourceIsFolder || resourceExtname == .spec)",
      group: "gauge@3",
    },
  ]);
  assert.deepEqual(manifest.contributes.menus["editor/title"], [
    {
      command: "gauge.preview",
      when: gaugeEditorWhen,
      group: "navigation@10",
    },
  ]);
  assert.deepEqual(manifest.contributes.menus["editor/context"], [
    {
      command: "gauge.preview",
      when: gaugeEditorWhen,
      group: "navigation@10",
    },
    {
      command: "gauge.extract.concept",
      when: gaugeEditorWhen,
      group: "1_modification",
    },
    {
      command: "gauge.format",
      when: gaugeEditorWhen,
      group: "1_modification",
    },
    {
      command: "gauge.toggle.lineComment",
      when: gaugeEditorWhen,
      group: "1_modification",
    },
  ]);

  const configuration = manifest.contributes.configuration.properties;
  assert.deepEqual(configuration["gauge.executablePath"], {
    type: "string",
    default: "",
    description: "Path to the Gauge executable. Leave empty to use Gauge from PATH. "
      + "Takes effect after a window reload.",
  });
  assert.deepEqual(configuration["gauge.home"], {
    type: "string",
    default: "",
    description: "Path to GAUGE_HOME. Leave empty to use the process environment or the Gauge default. "
      + "Takes effect after a window reload.",
  });
  assert.equal(configuration["gauge.specExplorer.enabled"].default, true);
  assert.equal(configuration["gauge.execution.debugPort"].default, 9229);
  // references/gauge-vscode/package.json declares this as "int", which is not a
  // JSON Schema type, so VS Code cannot build a Settings UI widget for it and
  // the port can only be changed by hand-editing settings.json.
  assert.equal(configuration["gauge.execution.debugPort"].type, "integer");
  const configurationTypes = new Set(["string", "boolean", "number", "integer", "array", "object"]);
  for (const [key, schema] of Object.entries(configuration)) {
    assert.equal(configurationTypes.has(schema.type), true, `${key} has type ${schema.type}`);
  }
  assert.equal(configuration["gauge.codeLenses.execution"].default, true);
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
        description: "[Gauge] Run specs in alphabetical order, or set the order of spec execution to alpha or random",
        anyOf: [
          {
            type: "boolean",
          },
          {
            type: "string",
            enum: [
              "alpha",
              "random",
            ],
          },
        ],
        default: false,
      },
      "random-seed": {
        description: "[Gauge] Random seed for reproducible random execution. Used only when --sort=random",
        type: "number",
        default: 0,
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
        description: "[Gauge] Executes the specs and scenarios only for the selected rows. It can be specified by range as 2-4 or as list 2,4",
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
  const conceptGrammar = manifest.contributes.grammars.find(
    (entry) => entry.language === "gauge-concept",
  );
  assert.ok(conceptGrammar);
  assert.equal(conceptGrammar.scopeName, "text.gauge.concept");
  assert.equal(conceptGrammar.path, "./syntaxes/gauge-concept.tmLanguage.json");

  // No contributes.snippets. src/gaugeSnippetCompletion.js registers the same
  // snippets/gauge.json at runtime, and a manifest contribution for the gauge and
  // gauge-concept languages fires alongside it, so every snippet was offered
  // twice in a .spec or .cpt. The runtime provider is the single source because
  // it is the only one that can apply the gauge_specs_dir rule to Markdown
  // specifications, which a language-keyed contribution cannot express.
  assert.equal(manifest.contributes.snippets, undefined);

  for (const relativePath of [
    language.configuration,
    grammar.path,
    conceptGrammar.path,
  ]) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), true, relativePath);
  }
  assert.equal(fs.existsSync(path.join(root, "scripts", "build-extension.js")), true);

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
      { open: "<", close: ">" },
      { open: "\"", close: "\"" },
    ],
    surroundingPairs: [
      ["<", ">"],
      ["\"", "\""],
    ],
  });

  // The file src/gaugeSnippetCompletion.js requires directly.
  const snippets = JSON.parse(
    fs.readFileSync(path.join(root, "snippets", "gauge.json"), "utf8"),
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
  for (const [columns, name] of [
    [1, "Legacy Table with one column"],
    [2, "Legacy Table with two columns"],
    [3, "Legacy Table with three columns"],
    [4, "Legacy Table with four columns"],
    [5, "Legacy Table with five columns"],
    [6, "Legacy Table with six columns"],
  ]) {
    assert.deepEqual(snippets[name].body, legacyTableSnippetBody(columns));
  }
});

test("packaging policy includes only the production bundle", () => {
  const ignored = new Set(readVscodeIgnore());

  assert.equal(ignored.has("src/**"), true);
  assert.equal(ignored.has("node_modules/**"), true);
  assert.equal(ignored.has("out/**/*.map"), true);

  const packageScript = fs.readFileSync(
    path.join(root, "scripts", "package-vsix.js"),
    "utf8",
  );
  assert.match(packageScript, /MAX_VSIX_FILES/);
  assert.match(packageScript, /MAX_VSIX_BYTES/);
  assert.match(packageScript, /extension\/out\/extension\.js/);
  assert.match(packageScript, /extension\/(?:src|node_modules)/);
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
      "#step",
      "#teardown",
      "#table",
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

test("extension manifest contributes a Concept TextMate grammar", () => {
  const manifest = readPackageJson();
  const grammar = manifest.contributes.grammars.find((entry) => entry.language === "gauge-concept");

  assert.deepEqual(grammar, {
    language: "gauge-concept",
    scopeName: "text.gauge.concept",
    path: "./syntaxes/gauge-concept.tmLanguage.json",
  });

  const grammarJson = JSON.parse(fs.readFileSync(path.join(root, grammar.path), "utf8"));
  assert.equal(grammarJson.scopeName, "text.gauge.concept");
  assert.deepEqual(
    grammarJson.patterns.map((entry) => entry.include),
    [
      "#frontMatter",
      "#comments",
      "#conceptHeading",
      "#step",
      "#table",
      "#markdown",
      "#fallbackComment",
    ],
  );
  assert.equal(Object.hasOwn(grammarJson.repository, "tags"), false);
  assert.equal(Object.hasOwn(grammarJson.repository, "tableKeyword"), false);
  assert.ok(
    grammarJson.repository.markdown.patterns.some((entry) => entry.include === "#markdownTypeScriptFencedCode"),
    "Concept grammar should preserve broad Markdown fenced-code injections",
  );
  assertPatternMatches(grammarJson.repository.markdownTypeScriptFencedCode, "```ts", "```ts");
  assert.equal(grammarJson.repository.markdownTypeScriptFencedCode.contentName, "meta.embedded.block.typescript");
  assert.deepEqual(grammarJson.repository.markdownTypeScriptFencedCode.patterns, [{ include: "source.ts" }]);
  assert.equal(firstMatchingTopLevelPattern(grammarJson, "tags: smoke").include, "#fallbackComment");
  assert.equal(firstMatchingTopLevelPattern(grammarJson, "table: users.csv").include, "#fallbackComment");
  assert.equal(firstMatchingTopLevelPattern(grammarJson, "plain <arg>").include, "#fallbackComment");
  assert.equal(firstMatchingTopLevelPattern(grammarJson, "plain \"arg\"").include, "#fallbackComment");
  assertPatternMatches(grammarJson.repository.tableRow, "| name |", "|");
  assertPatternMatches(grammarJson.repository.tableRow, "| name", "|");
});

test("Gauge TextMate grammar follows Gauge lexer line starts and keywords", () => {
  const manifest = readPackageJson();
  const grammar = manifest.contributes.grammars.find((entry) => entry.language === "gauge");
  const grammarJson = JSON.parse(fs.readFileSync(path.join(root, grammar.path), "utf8"));

  assertPatternMatches(grammarJson.repository.tags, "TAGS : smoke", "TAGS : ");
  assertPatternMatches(grammarJson.repository.tableKeyword, "Table : users.csv", "Table : ");

  assertPatternMatches(repositoryPattern(grammarJson, "specHeading", 0), "#Title", "#");
  assertPatternMatches(repositoryPattern(grammarJson, "scenarioHeading", 0), "##Scenario");
  assertPatternMatches(repositoryPattern(grammarJson, "scenarioHeading", 0), "### Notes", "### Notes");
  assert.equal(firstMatchingTopLevelPattern(grammarJson, "### Notes").include, "#scenarioHeading");
  assertPatternMatches(repositoryPattern(grammarJson, "specHeading", 1), "=", "=");
  assertPatternMatches(repositoryPattern(grammarJson, "scenarioHeading", 1), "-", "-");
  assertPatternDoesNotMatch(repositoryPattern(grammarJson, "specHeading", 1), " = ");
  assertPatternDoesNotMatch(repositoryPattern(grammarJson, "scenarioHeading", 1), " - ");

  assertPatternMatches(grammarJson.repository.step, "* do something", "* ");
  assertPatternMatches(grammarJson.repository.step, "  * do something", "  * ");
  assertPatternMatches(grammarJson.repository.step, "** bold step", "*");
  assertPatternMatches(grammarJson.repository.teardown, "___", "___");
  assertPatternMatches(grammarJson.repository.teardown, "___  ", "___  ");
  assertPatternMatches(grammarJson.repository.teardown, "  ___", "  ___");
  assertPatternMatches(grammarJson.repository.tableRow, "| name |", "|");
  assertPatternMatches(grammarJson.repository.tableRow, "  | table cell |", "  |");
  assertPatternMatches(grammarJson.repository.tableRow, "| name", "|");
  assertPatternMatches(grammarJson.repository.tableSeparator, "  |---|", "  |");
});

test("Gauge TextMate grammar ends tags at the current line", () => {
  const manifest = readPackageJson();
  const grammar = manifest.contributes.grammars.find((entry) => entry.language === "gauge");
  const grammarJson = JSON.parse(fs.readFileSync(path.join(root, grammar.path), "utf8"));
  const tags = grammarJson.repository.tags;
  const tagValue = repositoryPattern(grammarJson, "tags", 0);
  const tagEnd = { match: tags.end };

  assertPatternMatches(tags, "tags: smoke,", "tags: ");
  assertPatternMatches(tagValue, "smoke,", "smoke");
  assertPatternMatchesAt(tagEnd, "smoke,", "smoke,".length);
  assertPatternMatchesAt(tagEnd, "smoke,   ", "smoke,   ".length);
  assertPatternMatchesAt(tagEnd, "fast", "fast".length);
});

test("Gauge TextMate grammar closes tag lines without continuation boundaries", () => {
  const manifest = readPackageJson();
  const grammar = manifest.contributes.grammars.find((entry) => entry.language === "gauge");
  const grammarJson = JSON.parse(fs.readFileSync(path.join(root, grammar.path), "utf8"));
  const tagEnd = { match: grammarJson.repository.tags.end };

  for (const line of [
    "# Next specification",
    "## Next scenario",
    "* Pay",
    "table: users.csv",
    "tags: fast",
    "| name |",
    "___",
    "// disabled",
  ]) {
    assertPatternMatchesAt(tagEnd, line, line.length);
  }
  assertPatternMatchesAt(tagEnd, "fast", "fast".length);
});

test("Gauge TextMate grammar handles table and argument lexer edge cases", () => {
  const manifest = readPackageJson();
  const grammar = manifest.contributes.grammars.find((entry) => entry.language === "gauge");
  const grammarJson = JSON.parse(fs.readFileSync(path.join(root, grammar.path), "utf8"));
  const dynamicArgument = repositoryPattern(grammarJson, "arguments", 0);
  const staticArgument = repositoryPattern(grammarJson, "arguments", 1);
  const tableDynamicArgument = repositoryPattern(grammarJson, "tableArguments", 0);
  const tableSeparatorPipe = repositoryPattern(grammarJson, "tableRow", 0);
  const fallbackComment = grammarJson.repository.fallbackComment;

  assertPatternMatches(dynamicArgument, "<name \\> suffix>", "<name \\> suffix>");
  assertPatternMatches(dynamicArgument, "<>", "<>");
  assertPatternDoesNotMatch(dynamicArgument, "\\<escaped>");
  assertPatternDoesNotMatch(staticArgument, "\\\"escaped");
  assertPatternMatches(tableDynamicArgument, "<user>", "<user>");
  assertPatternDoesNotMatch(tableDynamicArgument, "\\<user>");
  assertPatternDoesNotMatch(tableDynamicArgument, "<user | admin>");
  assert.equal(
    grammarJson.repository.tableArguments.patterns.some((entry) => entry.include === "#arguments"),
    false,
  );
  assertPatternMatches(tableSeparatorPipe, "|", "|");
  assertPatternDoesNotMatch(tableSeparatorPipe, "\\|");
  assertPatternMatches(fallbackComment, "plain comment");
  assert.equal(firstMatchingTopLevelPattern(grammarJson, "plain <arg>").include, "#fallbackComment");
  assert.equal(firstMatchingTopLevelPattern(grammarJson, "plain \"arg\"").include, "#fallbackComment");
  assert.equal(firstMatchingTopLevelPattern(grammarJson, "___").include, "#teardown");
  assert.equal(firstMatchingTopLevelPattern(grammarJson, "  ___").include, "#teardown");
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
  assertPatternDoesNotMatch(repositoryPattern(grammarJson, "dynamicArguments", 0), "\\<item>");
  assertPatternDoesNotMatch(repositoryPattern(grammarJson, "dynamicArguments", 0), "\"card\"");
});

test("Gauge Concept TextMate grammar ignores escaped argument starts", () => {
  const manifest = readPackageJson();
  const grammar = manifest.contributes.grammars.find((entry) => entry.language === "gauge-concept");
  const grammarJson = JSON.parse(fs.readFileSync(path.join(root, grammar.path), "utf8"));

  assertPatternDoesNotMatch(repositoryPattern(grammarJson, "dynamicArguments", 0), "\\<item>");
  assertPatternDoesNotMatch(repositoryPattern(grammarJson, "arguments", 0), "\\<item>");
  assertPatternDoesNotMatch(repositoryPattern(grammarJson, "arguments", 1), "\\\"item");
  assertPatternDoesNotMatch(repositoryPattern(grammarJson, "tableArguments", 0), "\\<item>");
  assert.equal(
    grammarJson.repository.tableArguments.patterns.some((entry) => entry.include === "#arguments"),
    false,
  );
});

test("Gauge TextMate grammar preserves common Markdown constructs", () => {
  const manifest = readPackageJson();
  const grammar = manifest.contributes.grammars.find((entry) => entry.language === "gauge");
  const grammarJson = JSON.parse(fs.readFileSync(path.join(root, grammar.path), "utf8"));
  const markdownBlockquote = repositoryPattern(grammarJson, "markdownBlockquote");
  const markdownAutoLink = repositoryPattern(grammarJson, "markdownAutoLink");
  const markdownBasicFence = grammarJson.repository.markdownBasicFencedCode;
  const markdownCSharpFence = grammarJson.repository.markdownCSharpFencedCode;
  const markdownCssFence = grammarJson.repository.markdownCssFencedCode;
  const markdownDockerfileFence = grammarJson.repository.markdownDockerfileFencedCode;
  const markdownFence = repositoryPattern(grammarJson, "markdownFencedCode");
  const markdownGoFence = grammarJson.repository.markdownGoFencedCode;
  const markdownHtmlBlock = grammarJson.repository.markdownHtmlBlock;
  const markdownImage = repositoryPattern(grammarJson, "markdownImage");
  const markdownJavaFence = grammarJson.repository.markdownJavaFencedCode;
  const markdownJavaScriptFence = grammarJson.repository.markdownJavaScriptFencedCode;
  const markdownJsonFence = grammarJson.repository.markdownJsonFencedCode;
  const markdownKotlinFence = grammarJson.repository.markdownKotlinFencedCode;
  const markdownPhpFence = grammarJson.repository.markdownPhpFencedCode;
  const markdownPythonFence = grammarJson.repository.markdownPythonFencedCode;
  const markdownReferenceImage = repositoryPattern(grammarJson, "markdownReferenceImage");
  const markdownReferenceLink = repositoryPattern(grammarJson, "markdownReferenceLink");
  const markdownRustFence = grammarJson.repository.markdownRustFencedCode;
  const markdownShellFence = grammarJson.repository.markdownShellFencedCode;
  const markdownSqlFence = grammarJson.repository.markdownSqlFencedCode;
  const markdownTsxFence = grammarJson.repository.markdownTsxFencedCode;
  const markdownTypeScriptFence = grammarJson.repository.markdownTypeScriptFencedCode;
  const markdownXmlFence = grammarJson.repository.markdownXmlFencedCode;
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
    "#markdownCssFencedCode",
    "#markdownBasicFencedCode",
    "#markdownIniFencedCode",
    "#markdownJavaFencedCode",
    "#markdownLuaFencedCode",
    "#markdownMakefileFencedCode",
    "#markdownPerlFencedCode",
    "#markdownRFencedCode",
    "#markdownRubyFencedCode",
    "#markdownPhpFencedCode",
    "#markdownSqlFencedCode",
    "#markdownVsNetFencedCode",
    "#markdownXmlFencedCode",
    "#markdownXslFencedCode",
    "#markdownYamlFencedCode",
    "#markdownDosbatchFencedCode",
    "#markdownClojureFencedCode",
    "#markdownCoffeeFencedCode",
    "#markdownCFencedCode",
    "#markdownCppFencedCode",
    "#markdownDiffFencedCode",
    "#markdownDockerfileFencedCode",
    "#markdownGitCommitFencedCode",
    "#markdownGitRebaseFencedCode",
    "#markdownGoFencedCode",
    "#markdownGroovyFencedCode",
    "#markdownJadeFencedCode",
    "#markdownJavaScriptFencedCode",
    "#markdownJsRegexpFencedCode",
    "#markdownJsonFencedCode",
    "#markdownLessFencedCode",
    "#markdownObjcFencedCode",
    "#markdownScssFencedCode",
    "#markdownPerl6FencedCode",
    "#markdownPowershellFencedCode",
    "#markdownPythonFencedCode",
    "#markdownRegexpPythonFencedCode",
    "#markdownRustFencedCode",
    "#markdownScalaFencedCode",
    "#markdownShellFencedCode",
    "#markdownTypeScriptFencedCode",
    "#markdownTsxFencedCode",
    "#markdownCSharpFencedCode",
    "#markdownFSharpFencedCode",
    "#markdownFencedCode",
    "#markdownLinkDefinition",
    "#markdownHtmlBlock",
    "#markdownList",
    "#markdownInline",
  ]);
  assertPatternMatches(markdownCssFence, "```css", "```css");
  assertPatternMatches(markdownCssFence, "~~~css.erb", "~~~css.erb");
  assert.equal(markdownCssFence.contentName, "meta.embedded.block.css");
  assert.deepEqual(markdownCssFence.patterns, [{ include: "source.css" }]);
  assertPatternMatches(markdownBasicFence, "```html", "```html");
  assertPatternMatches(markdownBasicFence, "~~~xhtml", "~~~xhtml");
  assert.equal(markdownBasicFence.contentName, "meta.embedded.block.html");
  assert.deepEqual(markdownBasicFence.patterns, [{ include: "text.html.basic" }]);
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
  assertPatternMatches(markdownJavaScriptFence, "```jsx", "```jsx");
  assert.equal(markdownJavaScriptFence.contentName, "meta.embedded.block.javascript");
  assert.deepEqual(markdownJavaScriptFence.patterns, [{ include: "source.js" }]);
  assertPatternMatches(markdownJsonFence, "```json", "```json");
  assertPatternMatches(markdownJsonFence, "~~~sublime-settings", "~~~sublime-settings");
  assert.equal(markdownJsonFence.contentName, "meta.embedded.block.json");
  assert.deepEqual(markdownJsonFence.patterns, [{ include: "source.json" }]);
  assertPatternMatches(markdownPhpFence, "```php", "```php");
  assert.equal(markdownPhpFence.contentName, "meta.embedded.block.php");
  assert.deepEqual(markdownPhpFence.patterns, [{ include: "text.html.php#language" }]);
  assertPatternMatches(markdownPythonFence, "```python", "```python");
  assertPatternMatches(markdownPythonFence, "~~~py", "~~~py");
  assertPatternMatches(markdownPythonFence, "```gypi", "```gypi");
  assert.equal(markdownPythonFence.contentName, "meta.embedded.block.python");
  assert.deepEqual(markdownPythonFence.patterns, [{ include: "source.python" }]);
  assertPatternMatches(markdownSqlFence, "```ddl", "```ddl");
  assert.equal(markdownSqlFence.contentName, "meta.embedded.block.sql");
  assert.deepEqual(markdownSqlFence.patterns, [{ include: "source.sql" }]);
  assertPatternMatches(markdownXmlFence, "```xml", "```xml");
  assertPatternMatches(markdownXmlFence, "~~~cpt", "~~~cpt");
  assert.equal(markdownXmlFence.contentName, "meta.embedded.block.xml");
  assert.deepEqual(markdownXmlFence.patterns, [{ include: "text.xml" }]);
  assertPatternMatches(markdownDockerfileFence, "```Dockerfile", "```Dockerfile");
  assert.equal(markdownDockerfileFence.contentName, "meta.embedded.block.dockerfile");
  assert.deepEqual(markdownDockerfileFence.patterns, [{ include: "source.dockerfile" }]);
  assertPatternMatches(markdownGoFence, "```golang", "```golang");
  assert.equal(markdownGoFence.contentName, "meta.embedded.block.go");
  assert.deepEqual(markdownGoFence.patterns, [{ include: "source.go" }]);
  assertPatternMatches(markdownRustFence, "```rs", "```rs");
  assert.equal(markdownRustFence.contentName, "meta.embedded.block.rust");
  assert.deepEqual(markdownRustFence.patterns, [{ include: "source.rust" }]);
  assertPatternMatches(markdownShellFence, "```bash", "```bash");
  assertPatternMatches(markdownShellFence, "~~~zsh", "~~~zsh");
  assertPatternMatches(markdownShellFence, "```bash_profile", "```bash_profile");
  assert.equal(markdownShellFence.contentName, "meta.embedded.block.shellscript");
  assert.deepEqual(markdownShellFence.patterns, [{ include: "source.shell" }]);
  assertPatternMatches(markdownTypeScriptFence, "```typescript", "```typescript");
  assertPatternMatches(markdownTypeScriptFence, "~~~ts", "~~~ts");
  assert.equal(markdownTypeScriptFence.contentName, "meta.embedded.block.typescript");
  assert.deepEqual(markdownTypeScriptFence.patterns, [{ include: "source.ts" }]);
  assertPatternMatches(markdownTsxFence, "```tsx", "```tsx");
  assert.equal(markdownTsxFence.contentName, "meta.embedded.block.typescriptreact");
  assert.deepEqual(markdownTsxFence.patterns, [{ include: "source.tsx" }]);
  assertPatternMatches(markdownCSharpFence, "```c#", "```c#");
  assert.equal(markdownCSharpFence.contentName, "meta.embedded.block.csharp");
  assert.deepEqual(markdownCSharpFence.patterns, [{ include: "source.cs" }]);
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

test("extension package ignores development files while keeping the production bundle", () => {
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
    "src/**",
    "node_modules/**",
    "out/**/*.map",
    "package-lock.json",
  ]) {
    assert.ok(ignored.includes(pattern), `missing ${pattern}`);
  }

  for (const runtimePattern of [
    "out/**",
    "resources/**",
    "snippets/**",
    "syntaxes/**",
    "language-configuration.json",
    "package.json",
  ]) {
    assert.ok(!ignored.includes(runtimePattern), `runtime pattern must stay packaged: ${runtimePattern}`);
  }
  assert.equal(manifest.main, "./out/extension.js");
});

// A user installing this extension sees only the marketplace page: the README,
// the changelog and the notices. The README used to describe four bullet points
// of a surface that contributes twenty commands, twenty-seven settings, a tree
// view, a debugger and three keybindings.
test("README documents the contributed command and configuration surface", () => {
  const manifest = readPackageJson();
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

  for (const { command } of manifest.contributes.commands) {
    assert.ok(readme.includes(command), `README does not mention ${command}`);
  }
  for (const key of Object.keys(manifest.contributes.configuration.properties)) {
    assert.ok(readme.includes(key), `README does not mention ${key}`);
  }
  for (const keybinding of manifest.contributes.keybindings) {
    assert.ok(readme.includes(keybinding.key), `README does not mention ${keybinding.key}`);
  }
  assert.ok(readme.includes("Gauge Specs"), "README does not mention the tree view");
  assert.ok(readme.includes("Test Explorer"), "README does not mention Test Explorer support");
});

test("extension ships a changelog", () => {
  const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  const manifest = readPackageJson();

  assert.ok(changelog.includes(manifest.version), `CHANGELOG does not mention ${manifest.version}`);
});

// The bundle is built with esbuild legalComments: "none", so every embedded
// license header is stripped from the shipped copies of these packages.
test("third-party notices cover every bundled runtime dependency", () => {
  const notices = fs.readFileSync(path.join(root, "THIRD_PARTY_NOTICES.md"), "utf8");
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const runtimePackages = Object.entries(lock.packages || {})
    .filter(([name, meta]) => name.startsWith("node_modules/") && !meta.dev)
    .map(([name]) => name.slice("node_modules/".length));

  assert.ok(runtimePackages.length > 0);
  for (const name of runtimePackages) {
    assert.ok(notices.includes(name), `THIRD_PARTY_NOTICES does not list ${name}`);
  }
});

// An asset shipped byte-for-byte from another project is a redistribution, and
// the notices are where its licence and copyright have to appear. The check is
// on the bytes rather than on a list, so a file copied later cannot ship
// uncredited.
test("every asset copied from the reference extension is credited", () => {
  const crypto = require("node:crypto");
  const referenceRoot = path.join(root, "..", "references", "gauge-vscode");
  const notices = fs.readFileSync(path.join(root, "THIRD_PARTY_NOTICES.md"), "utf8");
  const digest = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

  const assets = [];
  for (const directory of ["images", "resources"]) {
    const walk = (relative) => {
      const absolute = path.join(root, relative);
      if (!fs.existsSync(absolute)) {
        return;
      }
      for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
        const next = path.posix.join(relative, entry.name);
        if (entry.isDirectory()) {
          walk(next);
        } else {
          assets.push(next);
        }
      }
    };
    walk(directory);
  }
  assert.ok(assets.length > 0);

  const uncredited = assets.filter((asset) => {
    const reference = path.join(referenceRoot, asset);
    if (!fs.existsSync(reference)) {
      return false;
    }
    if (digest(path.join(root, asset)) !== digest(reference)) {
      return false;
    }
    return !notices.includes(asset);
  });

  assert.deepEqual(uncredited, []);
});

// A version in the notices that does not match the lockfile is a claim about
// what ships that nobody checked. The table is the licence record for a bundle
// built with legalComments: "none", so it has to track the tree it is built
// from.
test("every version in the notices matches the lockfile", () => {
  const notices = fs.readFileSync(path.join(root, "THIRD_PARTY_NOTICES.md"), "utf8");
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const rows = [...notices.matchAll(/^\| `([^`]+)` \| ([^|]+?) \| /gm)]
    .map((match) => ({ name: match[1], version: match[2].trim() }));
  assert.ok(rows.length > 0);

  const mismatched = rows
    .map((row) => ({
      ...row,
      installed: (lock.packages[`node_modules/${row.name}`] || {}).version,
    }))
    .filter((row) => row.installed !== row.version);

  assert.deepEqual(mismatched, []);
});

// The README names some commands by the title the palette shows. A title that
// does not match the manifest sends the reader looking for something that is
// not there.
test("every command title the README spells matches the manifest", () => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const manifest = readPackageJson();
  const titles = new Set(manifest.contributes.commands.map((command) => (
    command.category ? `${command.category}: ${command.title}` : command.title
  )));
  const named = [...readme.matchAll(/\*\*(Gauge: [^*]+)\*\*/g)].map((match) => match[1]);
  assert.ok(named.length > 0);

  assert.deepEqual(named.filter((title) => !titles.has(title)), []);
});

test("extension package script requires repository metadata", () => {
  const packageScript = fs.readFileSync(path.join(root, "scripts", "package-vsix.js"), "utf8");

  assert.equal(packageScript.includes("--allow-missing-repository"), false);
});

// `npm run package` is the last stage of `npm run check`, and `npm run lint` is
// the first. Removing node_modules on the way out left the next `npm run check`
// with no eslint, so the gate could not run twice without a reinstall. The
// `npm ci` this script already performs is what guarantees a clean tree for
// packaging; the VSIX is kept free of dependencies by --no-dependencies and by
// the entry assertion below it.
test("extension package script leaves the checkout able to run the gate again", () => {
  const packageScript = fs.readFileSync(path.join(root, "scripts", "package-vsix.js"), "utf8");

  assert.equal(/rmSync\([^)]*node_modules/.test(packageScript), false);
  assert.equal(packageScript.includes("--no-dependencies"), true);
});

test("extension manifest preserves the official Gauge configuration schema", () => {
  const manifest = readPackageJson();
  const referenceManifest = readReferencePackageJson();
  const configuration = manifest.contributes.configuration.properties;
  const referenceConfiguration = referenceManifest.contributes.configuration.properties;
  // gauge.execution.debugPort is the one deliberate divergence: the reference
  // declares its type as "int", which is not a JSON Schema type, so VS Code
  // cannot render an editor for it in the Settings UI. Everything else about the
  // property, including its default and description, still matches.
  const divergentTypeKeys = new Set(["gauge.execution.debugPort"]);
  // gauge.welcomeNotification.showOn is the second deliberate divergence, in the
  // description only. The reference says it controls a "welcome page"; this
  // extension has none - src/welcomeNotifications.js shows a single information
  // notification - and the reference wording also states a default ("on upgrade")
  // that contradicts the declared value. Everything else about the property
  // matches.
  const divergentDescriptionKeys = new Set(["gauge.welcomeNotification.showOn"]);
  const sharedKeys = Object.keys(referenceConfiguration).filter((key) => configuration[key]);

  const withoutDivergentType = (key, schema) => {
    const comparable = comparableConfigurationSchema(schema);
    if (divergentTypeKeys.has(key)) {
      comparable.type = undefined;
    }
    if (divergentDescriptionKeys.has(key)) {
      comparable.description = undefined;
    }
    return comparable;
  };

  assert.deepEqual(
    Object.fromEntries(sharedKeys.map((key) => [key, withoutDivergentType(key, configuration[key])])),
    Object.fromEntries(
      sharedKeys.map((key) => [key, withoutDivergentType(key, referenceConfiguration[key])]),
    ),
  );
  assert.equal(referenceConfiguration["gauge.execution.debugPort"].type, "int");
  assert.equal(configuration["gauge.execution.debugPort"].type, "integer");
  assert.match(
    referenceConfiguration["gauge.welcomeNotification.showOn"].description,
    /welcome page/,
  );
  assert.match(
    configuration["gauge.welcomeNotification.showOn"].description,
    /Gauge plugin initialised/,
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

test("extension manifest drops the Gauge recommended settings surface", () => {
  const manifest = readPackageJson();
  const referenceManifest = readReferencePackageJson();

  // gauge-vscode recommends files.autoSave because it only saves when the
  // language server asks. This extension saves before every execution, rename,
  // format and saveFiles request, so the recommendation is dead weight that only
  // writes a .vscode/settings.json into the user project.
  assert.ok(
    referenceManifest.contributes.commands
      .some((entry) => entry.command === "gauge.config.saveRecommended"),
  );
  assert.ok(
    referenceManifest.contributes.configuration.properties["gauge.recommendedSettings.options"],
  );

  assert.equal(
    manifest.contributes.commands
      .some((entry) => entry.command === "gauge.config.saveRecommended"),
    false,
  );
  assert.equal(
    manifest.contributes.menus.commandPalette
      .some((entry) => entry.command === "gauge.config.saveRecommended"),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      manifest.contributes.configuration.properties,
      "gauge.recommendedSettings.options",
    ),
    false,
  );
});

// contributes.snippets is a static contribution: VS Code reads it at startup,
// independently of activation, and applies it to every document of that
// language in every workspace. references/gauge-vscode contributes snippets only
// for its own `gauge` language. Contributing them for `markdown` put `spec`,
// `sce`, `cpt` and the table snippets into every Markdown file the user ever
// opens, in any repository. Gauge Markdown specifications get them from
// GaugeSnippetCompletionProvider instead, which is scoped to Gauge projects.
// Snippets are contributed at runtime only, by src/gaugeSnippetCompletion.js. A
// manifest contribution for gauge and gauge-concept fired alongside it, so every
// snippet appeared twice in a .spec or .cpt; and a contribution can only key on a
// language, so it could never apply the gauge_specs_dir rule that keeps Gauge
// snippets out of a README.
test("Gauge snippets are contributed once, at runtime", () => {
  const manifest = readPackageJson();

  assert.equal(manifest.contributes.snippets, undefined);
});

// The tree view must disappear with its setting. gauge:activated no longer
// depends on gauge.specExplorer.enabled (see the 2026-08-27 spec explorer scope
// entry in docs/parity-progress.md), so without the config clause the view would
// render with no data provider registered behind it.
test("the Gauge Specs view follows its own setting", () => {
  const manifest = readPackageJson();
  const view = manifest.contributes.views.test.find((entry) => entry.id === "gauge:specExplorer");

  assert.ok(view);
  assert.equal(view.when, "gauge:activated && config.gauge.specExplorer.enabled");
});

// Every view/title entry must name the view it belongs to, or VS Code offers it
// in the title bar of unrelated views in the same container.
test("Gauge view title actions are scoped to the Gauge Specs view", () => {
  const manifest = readPackageJson();

  for (const entry of manifest.contributes.menus["view/title"]) {
    assert.ok(
      String(entry.when || "").includes("view == gauge:specExplorer"),
      `${entry.command} is not scoped to the Gauge Specs view`,
    );
  }
});

// A when-clause cannot read gauge_specs_dir, so the Explorer entry cannot tell a
// specification from a README. references/gauge-vscode contributes no
// explorer/context menu at all, so "right-click README.md -> Run Specification"
// exists nowhere but here. The .spec arm and the folder arm stay.
test("the Explorer run entry is not offered on Markdown files", () => {
  const manifest = readPackageJson();
  const entry = manifest.contributes.menus["explorer/context"]
    .find((item) => item.command === "gauge.execute.specification");

  assert.ok(entry);
  assert.equal(entry.when, "gauge:activated && (explorerResourceIsFolder || resourceExtname == .spec)");
});
