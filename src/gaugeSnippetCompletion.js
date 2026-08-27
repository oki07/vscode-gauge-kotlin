"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const snippetDefinitions = require("../snippets/gauge.json");

// contributes.snippets is a static contribution: VS Code reads it at startup,
// independently of activation, and applies it to every document of that language
// in every workspace. references/gauge-vscode contributes snippets only for its
// own `gauge` language, which is bound to `.spec` and `.cpt`, so it has nowhere
// to leak. This extension also treats Markdown inside a project's spec
// directories as a specification, and contributing the snippets for `markdown`
// put `spec`, `sce`, `cpt` and the table snippets into every Markdown file the
// user ever opened, in any repository. Serving them from a completion provider
// keeps the same snippets on Gauge documents and nowhere else.

const GAUGE_LANGUAGE = "gauge";
const GAUGE_CONCEPT_LANGUAGE = "gauge-concept";
const MARKDOWN_LANGUAGE = "markdown";
const MARKDOWN_FILE_PATTERN = /\.md$/i;
const SPEC_FILE_PATTERN = /\.spec$/i;
const CONCEPT_FILE_PATTERN = /\.cpt$/i;
const GAUGE_SPECS_DIRECTORY = "specs";
const GAUGE_SPECS_DIR_PROPERTY = "gauge_specs_dir";
const DEFAULT_ENV_PROPERTIES = ["env", "default", "default.properties"];

const DOCUMENT_SELECTOR = [
  { language: GAUGE_LANGUAGE },
  { language: GAUGE_CONCEPT_LANGUAGE },
  { scheme: "file", pattern: "**/*.spec" },
  { scheme: "file", pattern: "**/*.cpt" },
  { language: MARKDOWN_LANGUAGE, scheme: "file", pattern: "**/*.md" },
];

function getVscode(vscode) {
  return vscode || require("vscode");
}

function documentPath(document) {
  const uri = document && document.uri;
  return (uri && (uri.fsPath || uri.path)) || (document && document.fileName) || "";
}

function pathSegments(value) {
  return String(value || "")
    .split(/[\\/]/)
    .filter((segment) => segment !== "" && segment !== ".");
}

function startsWithSegments(segments, prefix) {
  return prefix.length > 0
    && segments.length >= prefix.length
    && prefix.every((segment, index) => segment === segments[index]);
}

function propertiesValue(content, key) {
  for (const rawLine of String(content || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) {
      continue;
    }
    const separator = line.search(/[=:\s]/);
    if (separator === -1 || line.slice(0, separator).trim() !== key) {
      continue;
    }
    return line.slice(separator + 1).replace(/^[=:\s]+/, "").trim();
  }
  return undefined;
}

function snippetItems(vscode) {
  return Object.values(snippetDefinitions).map((snippet) => {
    const body = Array.isArray(snippet.body) ? snippet.body.join("\n") : String(snippet.body || "");
    const item = typeof vscode.CompletionItem === "function"
      ? new vscode.CompletionItem(
        snippet.prefix,
        vscode.CompletionItemKind && vscode.CompletionItemKind.Snippet,
      )
      : { label: snippet.prefix, kind: vscode.CompletionItemKind && vscode.CompletionItemKind.Snippet };
    item.insertText = typeof vscode.SnippetString === "function"
      ? new vscode.SnippetString(body)
      : body;
    item.detail = snippet.description;
    return item;
  });
}

class GaugeSnippetCompletionProvider {
  constructor(options = {}) {
    this.vscode = getVscode(options.vscode);
    this.fileSystem = options.fileSystem || nodeFs;
    this.pathModule = options.pathModule || nodePath;
    this.projectFactory = options.projectFactory;
    this.disposed = false;
    this.disposable = undefined;
  }

  register() {
    if (this.disposed || this.disposable) {
      return { dispose() {} };
    }
    const languages = this.vscode.languages;
    if (!languages || typeof languages.registerCompletionItemProvider !== "function") {
      return { dispose() {} };
    }
    this.disposable = languages.registerCompletionItemProvider(DOCUMENT_SELECTOR, this);
    return { dispose: () => this.dispose() };
  }

  gaugeProjectRoot(file) {
    if (!this.projectFactory || typeof this.projectFactory.getGaugeRootFromFilePath !== "function") {
      return undefined;
    }
    try {
      const root = this.projectFactory.getGaugeRootFromFilePath(file);
      if (!root) {
        return undefined;
      }
      if (typeof this.projectFactory.isGaugeProject === "function") {
        return this.projectFactory.isGaugeProject(root) === false ? undefined : root;
      }
      return root;
    } catch (_error) {
      return undefined;
    }
  }

  // Same rule as src/stepDiagnostics.js: Gauge only reads Markdown as a
  // specification inside the directories named by gauge_specs_dir.
  specDirectories(projectRoot) {
    let configured = process.env[GAUGE_SPECS_DIR_PROPERTY];
    if (!configured && projectRoot && this.fileSystem
      && typeof this.fileSystem.readFileSync === "function") {
      try {
        configured = propertiesValue(
          this.fileSystem.readFileSync(
            this.pathModule.join(projectRoot, ...DEFAULT_ENV_PROPERTIES),
            "utf8",
          ),
          GAUGE_SPECS_DIR_PROPERTY,
        );
      } catch (_error) {
        configured = undefined;
      }
    }
    const directories = String(configured || "")
      .split(",")
      .map((entry) => pathSegments(entry.trim()))
      .filter((segments) => segments.length > 0);
    return directories.length > 0 ? directories : [[GAUGE_SPECS_DIRECTORY]];
  }

  isMarkdownSpecification(file) {
    const projectRoot = this.gaugeProjectRoot(file);
    if (!projectRoot) {
      return false;
    }
    const directories = pathSegments(file).slice(0, -1);
    const rootSegments = pathSegments(projectRoot);
    if (!startsWithSegments(directories, rootSegments)) {
      return directories.includes(GAUGE_SPECS_DIRECTORY);
    }
    const relative = directories.slice(rootSegments.length);
    return this.specDirectories(projectRoot)
      .some((specDir) => startsWithSegments(relative, specDir));
  }

  isGaugeDocument(document) {
    if (!document) {
      return false;
    }
    if (document.languageId === GAUGE_LANGUAGE || document.languageId === GAUGE_CONCEPT_LANGUAGE) {
      return true;
    }
    const file = documentPath(document);
    if (SPEC_FILE_PATTERN.test(file) || CONCEPT_FILE_PATTERN.test(file)) {
      return true;
    }
    return MARKDOWN_FILE_PATTERN.test(file) && this.isMarkdownSpecification(file);
  }

  provideCompletionItems(document) {
    if (this.disposed || !this.isGaugeDocument(document)) {
      return [];
    }
    return snippetItems(this.vscode);
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const disposable = this.disposable;
    this.disposable = undefined;
    if (disposable && typeof disposable.dispose === "function") {
      disposable.dispose();
    }
  }
}

module.exports = {
  GaugeSnippetCompletionProvider,
};
