"use strict";

const CONTROLLER_ID = "gauge";
const CONTROLLER_LABEL = "Gauge";
const RUN_PROFILE_LABEL = "Run";
const ROOT_PARENT_ID = "suite";

function getVscode(vscode) {
  return vscode || require("vscode");
}

function collectionAdd(collection, item) {
  if (collection && typeof collection.add === "function") {
    collection.add(item);
  }
}

function parseGaugeLocation(location) {
  const match = /^gauge:\/\/(.+):(\d+)$/.exec(String(location || ""));
  if (!match) {
    return undefined;
  }
  return {
    file: match[1],
    line: Math.max(0, Number.parseInt(match[2], 10) - 1),
  };
}

function createPosition(vscode, line, character) {
  return typeof vscode.Position === "function"
    ? new vscode.Position(line, character)
    : { line, character };
}

function createRange(vscode, line) {
  const start = createPosition(vscode, line, 0);
  const end = createPosition(vscode, line, 0);
  return typeof vscode.Range === "function"
    ? new vscode.Range(start, end)
    : { start, end };
}

function itemUri(vscode, location) {
  const parsed = parseGaugeLocation(location);
  if (!parsed || !vscode.Uri || typeof vscode.Uri.file !== "function") {
    return undefined;
  }
  return vscode.Uri.file(parsed.file);
}

function applyLocation(vscode, item, location) {
  const parsed = parseGaugeLocation(location);
  if (!parsed) {
    return item;
  }
  if (vscode.Range || vscode.Position) {
    item.range = createRange(vscode, parsed.line);
  }
  return item;
}

function createMessage(vscode, message) {
  if (typeof vscode.TestMessage === "function") {
    return new vscode.TestMessage(message || "");
  }
  return message || "";
}

class GaugeTestController {
  constructor(options = {}) {
    this.vscode = getVscode(options.vscode);
    this.executionController = options.executionController;
    this.controller = undefined;
    this.currentRun = undefined;
    this.items = new Map();
    this.pendingResults = new Map();
  }

  register() {
    if (!this.vscode.tests || typeof this.vscode.tests.createTestController !== "function") {
      return undefined;
    }
    this.controller = this.vscode.tests.createTestController(CONTROLLER_ID, CONTROLLER_LABEL);
    if (typeof this.controller.createRunProfile === "function") {
      const kind = this.vscode.TestRunProfileKind && this.vscode.TestRunProfileKind.Run;
      this.controller.createRunProfile(
        RUN_PROFILE_LABEL,
        kind,
        (request, token) => this.run(request, token),
        true,
      );
    }
    return {
      dispose: () => {
        if (this.controller && typeof this.controller.dispose === "function") {
          this.controller.dispose();
        }
      },
    };
  }

  setExecutionController(executionController) {
    this.executionController = executionController;
  }

  createExecutionEventSink() {
    return (event) => this.handleExecutionEvent(event);
  }

  startTestRun(request = {}) {
    if (!this.controller || typeof this.controller.createTestRun !== "function") {
      return undefined;
    }
    this.currentRun = this.controller.createTestRun(request);
    this.pendingResults.clear();
    return this.currentRun;
  }

  async run(request = {}) {
    const run = this.startTestRun(request);
    try {
      if (this.executionController && typeof this.executionController.handleCommand === "function") {
        await this.executionController.handleCommand("gauge.execute.specification.all");
      }
    } finally {
      if (run && typeof run.end === "function") {
        run.end();
      }
      if (this.currentRun === run) {
        this.currentRun = undefined;
      }
    }
  }

  ensureRun() {
    if (!this.currentRun) {
      this.startTestRun({});
    }
    return this.currentRun;
  }

  ensureItem(event) {
    const id = event && event.id;
    if (!id || !this.controller) {
      return undefined;
    }
    let item = this.items.get(id);
    if (!item) {
      const uri = itemUri(this.vscode, event.location);
      item = this.controller.createTestItem(id, event.name || id, uri);
      this.items.set(id, item);
      if (event.parentId && event.parentId !== ROOT_PARENT_ID) {
        const parent = this.ensureItem({
          id: event.parentId,
          name: event.parentId,
        });
        collectionAdd(parent && parent.children, item);
      } else {
        collectionAdd(this.controller.items, item);
      }
    } else if (event.name) {
      item.label = event.name;
    }
    return applyLocation(this.vscode, item, event.location);
  }

  finishItem(event) {
    const run = this.ensureRun();
    const item = this.ensureItem(event);
    if (!run || !item) {
      return;
    }
    const pending = this.pendingResults.get(event.id);
    this.pendingResults.delete(event.id);
    if (pending && pending.status === "failed" && typeof run.failed === "function") {
      run.failed(item, createMessage(this.vscode, pending.message), event.duration);
      return;
    }
    if (pending && pending.status === "skipped" && typeof run.skipped === "function") {
      run.skipped(item);
      return;
    }
    if (typeof run.passed === "function") {
      run.passed(item, event.duration);
    }
  }

  handleExecutionEvent(event) {
    if (!event || !event.type) {
      return;
    }
    const run = this.ensureRun();
    switch (event.type) {
      case "suiteStarted":
      case "testStarted": {
        const item = this.ensureItem(event);
        if (run && item && typeof run.started === "function") {
          run.started(item);
        }
        break;
      }
      case "suiteFinished":
      case "testFinished":
        this.finishItem(event);
        break;
      case "testFailed":
        this.pendingResults.set(event.id, {
          message: event.message,
          status: "failed",
        });
        break;
      case "testIgnored":
        this.pendingResults.set(event.id, {
          status: "skipped",
        });
        break;
      case "output":
        if (run && typeof run.appendOutput === "function") {
          run.appendOutput(event.message || "");
        }
        break;
      case "lineBreak":
        if (run && typeof run.appendOutput === "function") {
          run.appendOutput("\n");
        }
        break;
      default:
        break;
    }
  }
}

module.exports = {
  GaugeTestController,
};
