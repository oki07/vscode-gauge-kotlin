const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

function readPackageJson() {
  const packagePath = path.join(root, "package.json");
  return JSON.parse(fs.readFileSync(packagePath, "utf8"));
}

test("extension manifest exposes the core Gauge VS Code surface for Kotlin projects", () => {
  const manifest = readPackageJson();

  assert.equal(manifest.name, "vscode-gauge-kotlin");
  assert.equal(manifest.displayName, "Gauge Kotlin");
  assert.equal(manifest.main, "./src/extension.js");
  assert.equal(manifest.scripts.check, "node --test");
  assert.equal(manifest.dependencies["vscode-languageclient"], "~9.0.1");
  assert.deepEqual(manifest.categories, ["Programming Languages", "Testing"]);

  assert.deepEqual(manifest.activationEvents, [
    "onCommand:gauge.createProject",
    "workspaceContains:manifest.json",
    "onLanguage:gauge",
    "onDebugResolve:gauge",
  ]);

  const language = manifest.contributes.languages.find((entry) => entry.id === "gauge");
  assert.ok(language);
  assert.deepEqual(language.extensions, [".spec", ".cpt"]);
  assert.deepEqual(language.aliases, ["Gauge", "Specification", "Spec"]);
  assert.equal(language.configuration, "./language-configuration.json");

  const commandIds = manifest.contributes.commands.map((entry) => entry.command);
  assert.deepEqual(commandIds, [
    "gauge.createProject",
    "gauge.create.specification",
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

  const configuration = manifest.contributes.configuration.properties;
  assert.equal(configuration["gauge.specExplorer.enabled"].default, true);
  assert.equal(configuration["gauge.execution.debugPort"].default, 9229);
  assert.equal(configuration["gauge.codeLenses.reference"].default, true);
  assert.equal(configuration["gauge.kotlin.template"].default, "gradle");

  const debuggerContribution = manifest.contributes.debuggers.find(
    (entry) => entry.type === "gauge",
  );
  assert.ok(debuggerContribution);
  assert.deepEqual(debuggerContribution.initialConfigurations, [
    {
      name: "Gauge Run Option",
      type: "gauge",
      request: "test",
    },
  ]);

  const grammar = manifest.contributes.grammars.find((entry) => entry.language === "gauge");
  assert.ok(grammar);
  assert.equal(grammar.scopeName, "source.gauge");
  assert.equal(grammar.path, "./syntaxes/gauge.tmLanguage.json");

  assert.deepEqual(manifest.contributes.snippets, [
    {
      language: "gauge",
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
  assert.equal(languageConfiguration.comments.lineComment, "//");

  const snippets = JSON.parse(
    fs.readFileSync(path.join(root, manifest.contributes.snippets[0].path), "utf8"),
  );
  const snippetPrefixes = Object.values(snippets).map((entry) => entry.prefix);
  assert.deepEqual(snippetPrefixes, [
    "spec",
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
  assert.deepEqual(snippets.Scenario.body, [
    "## ${1:Scenario Heading}",
    "* $0",
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
