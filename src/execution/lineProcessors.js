"use strict";

class BaseProcessor {
  constructor(prefix) {
    this.eventPrefix = prefix;
  }

  canProcess(lineText) {
    return lineText.includes(this.eventPrefix);
  }
}

class ReportEventProcessor extends BaseProcessor {
  constructor(workspace) {
    super("Successfully generated html-report to => ");
    this.workspace = workspace;
  }

  process(lineText) {
    if (!this.canProcess(lineText)) {
      return;
    }
    const event = parseMachineReadableEvent(lineText);
    const text = event && String(event.type || "").toLowerCase() === "out"
      ? event.message
      : lineText;
    this.workspace.setReportPath(String(text || "").replace(this.eventPrefix, ""));
  }
}

class DebuggerAttachedEventProcessor extends BaseProcessor {
  constructor(executor, vscode) {
    super("Runner Ready for Debugging");
    this.executor = executor;
    this.vscode = vscode;
  }

  process(lineText, gaugeDebugger) {
    if (!this.canProcess(lineText)) {
      return Promise.resolve(undefined);
    }
    if (!gaugeDebugger) {
      return Promise.resolve(undefined);
    }

    gaugeDebugger.addProcessId(Number(lineText.replace(/^\D+/g, "")));
    return gaugeDebugger.startDebugger().catch((error) => {
      if (this.vscode && this.vscode.window) {
        this.vscode.window.showErrorMessage(`Failed to start debugger: ${error.message}`);
      }
      this.executor.cancel(false);
      return undefined;
    });
  }
}

class DebuggerNotAttachedEventProcessor extends BaseProcessor {
  constructor(executor, vscode) {
    super("No debugger attached");
    this.executor = executor;
    this.vscode = vscode;
  }

  process(lineText) {
    if (!this.canProcess(lineText)) {
      return;
    }
    if (this.vscode && this.vscode.window) {
      this.vscode.window.showErrorMessage("No debugger attached. Stopping the execution");
    }
    this.executor.cancel(false);
  }
}

const SUITE_ID = "suite";
const FILE_PREFIX = "gauge://";
const TABLE_ROW_SEPARATOR = "_";

function parseMachineReadableEvent(lineText) {
  const text = String(lineText || "").trim();
  if (!text.startsWith("{")) {
    return undefined;
  }
  try {
    const event = JSON.parse(text);
    return event && event.type ? event : undefined;
  } catch (_error) {
    return undefined;
  }
}

function eventLocation(event) {
  if (!event.filename || event.line === undefined || event.line === null) {
    return undefined;
  }
  return `${FILE_PREFIX}${event.filename}:${event.line}`;
}

function tableInfo(event) {
  return event && event.result && event.result.table;
}

function tableIdentifier(event, value) {
  const table = tableInfo(event);
  return table ? `${value}${TABLE_ROW_SEPARATOR}${table.rowIndex + 1}` : value;
}

function textWithLine(value) {
  if (!value) {
    return "";
  }
  return value.endsWith("\n") ? value : `${value}\n`;
}

function formatPart(value, prefix, suffix) {
  return value ? `${prefix}${value}${suffix}` : "";
}

function errorFilename(error) {
  if (!error || !error.filename) {
    return "";
  }
  return error.lineNo ? `${error.filename}:${error.lineNo}` : error.filename;
}

function formatExecutionError(error, status) {
  return formatPart(error && error.text, status, "\n")
    + formatPart(errorFilename(error), "Filename: ", "\n")
    + formatPart(error && error.message, "Message: ", "\n")
    + formatPart(error && error.stackTrace, "Stack Trace:\n", "");
}

function scenarioMessage(result, status) {
  const table = result && result.table;
  const tableText = table && table.text
    ? `${table.text.startsWith("\n") ? table.text.slice(1) : table.text}\n`
    : "";
  const errors = [];
  if (result && result.beforeHookFailure) {
    errors.push(result.beforeHookFailure);
  }
  if (result && Array.isArray(result.errors)) {
    errors.push(...result.errors);
  }
  if (result && result.afterHookFailure) {
    errors.push(result.afterHookFailure);
  }
  return tableText + errors
    .map((error) => formatExecutionError(error, status))
    .join("\n\n");
}

function addLocation(target, event) {
  const location = eventLocation(event);
  if (location) {
    target.location = location;
  }
  return target;
}

function hookFailureEvents(event, beforeName, afterName, idPrefix, parentId) {
  const result = (event && event.result) || {};
  const hooks = [
    { failure: result.beforeHookFailure, name: beforeName },
    { failure: result.afterHookFailure, name: afterName },
  ];
  const events = [];
  for (const hook of hooks) {
    if (!hook.failure) {
      continue;
    }
    const id = `${idPrefix || ""}${hook.name}`;
    events.push(addLocation({
      type: "testStarted",
      id,
      parentId,
      name: hook.name,
    }, event));
    events.push({
      type: "testFailed",
      id,
      parentId,
      name: hook.name,
      message: formatExecutionError(hook.failure, "Failed: "),
    });
    events.push({
      type: "testFinished",
      id,
      parentId,
      name: hook.name,
    });
  }
  return events;
}

function normalizeStatus(status) {
  return String(status || "").toLowerCase();
}

function machineReadableEvents(event) {
  const type = String(event.type || "").toLowerCase();
  switch (type) {
    case "suitestart":
      return [{ type: "lineBreak" }];
    case "suiteend":
      return hookFailureEvents(event, "Before Suite", "After Suite", "", SUITE_ID);
    case "specstart":
      return [
        addLocation({
          type: "suiteStarted",
          id: event.id,
          parentId: SUITE_ID,
          name: event.name,
        }, event),
      ];
    case "specend":
      return [
        ...hookFailureEvents(
          event,
          "Before Specification",
          "After Specification",
          event.id,
          event.id,
        ),
        {
          type: "suiteFinished",
          id: event.id,
          parentId: SUITE_ID,
          name: event.name,
          duration: event.result && event.result.time,
        },
      ];
    case "scenariostart":
      return [
        addLocation({
          type: "testStarted",
          id: tableIdentifier(event, event.id),
          parentId: event.parentId,
          name: tableIdentifier(event, event.name),
        }, event),
      ];
    case "scenarioend": {
      const id = tableIdentifier(event, event.id);
      const name = tableIdentifier(event, event.name);
      const result = event.result || {};
      const status = normalizeStatus(result.status);
      const events = [];
      if (status === "fail") {
        events.push({
          type: "testFailed",
          id,
          parentId: event.parentId,
          name,
          message: scenarioMessage(result, "Failed: "),
        });
      } else if (status === "skip") {
        events.push({
          type: "testIgnored",
          id,
          parentId: event.parentId,
          name,
          message: scenarioMessage(result, "Skipped: "),
        });
      }
      events.push({
        type: "testFinished",
        id,
        parentId: event.parentId,
        name,
        duration: result.time,
      });
      return events;
    }
    case "notification":
      return [
        {
          type: "notification",
          title: event.notification && event.notification.title,
          message: event.notification && event.notification.message,
          severity: event.notification && event.notification.type,
        },
      ];
    case "out":
      return [
        {
          type: "output",
          message: textWithLine(event.message || ""),
        },
      ];
    default:
      return [];
  }
}

class MachineReadableEventProcessor {
  constructor(sink) {
    this.sink = typeof sink === "function" ? sink : undefined;
  }

  canProcess(lineText) {
    return Boolean(parseMachineReadableEvent(lineText));
  }

  process(lineText) {
    const event = parseMachineReadableEvent(lineText);
    if (!event || !this.sink) {
      return;
    }
    for (const mapped of machineReadableEvents(event)) {
      this.sink(mapped);
    }
  }
}

module.exports = {
  DebuggerAttachedEventProcessor,
  DebuggerNotAttachedEventProcessor,
  MachineReadableEventProcessor,
  ReportEventProcessor,
  machineReadableEvents,
  parseMachineReadableEvent,
};
