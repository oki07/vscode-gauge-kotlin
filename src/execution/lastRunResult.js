"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");

const ROOT_PARENT_ID = "suite";
const LAST_RUN_RESULT_PATH = [".gauge", "last_run_result"];

class ProtobufReader {
  constructor(buffer) {
    this.buffer = Buffer.from(buffer || []);
    this.offset = 0;
  }

  get done() {
    return this.offset >= this.buffer.length;
  }

  readRawVarint() {
    let result = 0n;
    let shift = 0n;
    let byteCount = 0;
    while (this.offset < this.buffer.length) {
      const byte = this.buffer[this.offset];
      this.offset += 1;
      result |= BigInt(byte & 0x7f) << shift;
      byteCount += 1;
      if ((byte & 0x80) === 0) {
        return result;
      }
      if (byteCount >= 10) {
        throw new Error("Gauge result contains an unsupported integer");
      }
      shift += 7n;
    }
    throw new Error("Gauge result ended inside an integer");
  }

  readVarint() {
    const result = this.readRawVarint();
    if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Gauge result contains an unsupported integer");
    }
    return Number(result);
  }

  readInt32() {
    return Number(BigInt.asIntN(32, this.readRawVarint()));
  }

  readBytes() {
    const length = this.readVarint();
    const end = this.offset + length;
    if (end > this.buffer.length) {
      throw new Error("Gauge result ended inside a field");
    }
    const value = this.buffer.subarray(this.offset, end);
    this.offset = end;
    return value;
  }

  readString() {
    return this.readBytes().toString("utf8");
  }

  skip(wireType) {
    if (wireType === 0) {
      this.readRawVarint();
      return;
    }
    if (wireType === 1) {
      this.offset += 8;
      return;
    }
    if (wireType === 2) {
      this.readBytes();
      return;
    }
    if (wireType === 5) {
      this.offset += 4;
      return;
    }
    throw new Error(`Gauge result uses unsupported wire type ${wireType}`);
  }
}

function decode(buffer, visit) {
  const reader = new ProtobufReader(buffer);
  while (!reader.done) {
    const tag = reader.readVarint();
    const field = Math.floor(tag / 8);
    const wireType = tag & 7;
    if (!visit(field, wireType, reader)) {
      reader.skip(wireType);
    }
  }
}

function isWire(wireType, expected) {
  return wireType === expected;
}

function decodeHookFailure(buffer) {
  const hook = { errorMessage: "", stackTrace: "", tableRowIndex: -1 };
  decode(buffer, (field, wireType, reader) => {
    if (field === 1 && isWire(wireType, 2)) {
      hook.stackTrace = reader.readString();
      return true;
    }
    if (field === 2 && isWire(wireType, 2)) {
      hook.errorMessage = reader.readString();
      return true;
    }
    if (field === 4 && isWire(wireType, 0)) {
      hook.tableRowIndex = reader.readInt32();
      return true;
    }
    return false;
  });
  return hook;
}

function decodeExecutionResult(buffer) {
  const result = { errorMessage: "", failed: false, stackTrace: "" };
  decode(buffer, (field, wireType, reader) => {
    if (field === 1 && isWire(wireType, 0)) {
      result.failed = Boolean(reader.readVarint());
      return true;
    }
    if (field === 3 && isWire(wireType, 2)) {
      result.errorMessage = reader.readString();
      return true;
    }
    if (field === 4 && isWire(wireType, 2)) {
      result.stackTrace = reader.readString();
      return true;
    }
    return false;
  });
  return result;
}

function decodeStepExecutionResult(buffer) {
  const result = {};
  decode(buffer, (field, wireType, reader) => {
    if (field === 1 && isWire(wireType, 2)) {
      result.execution = decodeExecutionResult(reader.readBytes());
      return true;
    }
    if (field === 2 && isWire(wireType, 2)) {
      result.beforeHook = decodeHookFailure(reader.readBytes());
      return true;
    }
    if (field === 3 && isWire(wireType, 2)) {
      result.afterHook = decodeHookFailure(reader.readBytes());
      return true;
    }
    return false;
  });
  return result;
}

function decodeStep(buffer) {
  const step = { actualText: "" };
  decode(buffer, (field, wireType, reader) => {
    if (field === 1 && isWire(wireType, 2)) {
      step.actualText = reader.readString();
      return true;
    }
    if (field === 4 && isWire(wireType, 2)) {
      step.result = decodeStepExecutionResult(reader.readBytes());
      return true;
    }
    return false;
  });
  return step;
}

function decodeConcept(buffer) {
  const concept = { items: [] };
  decode(buffer, (field, wireType, reader) => {
    if (field === 1 && isWire(wireType, 2)) {
      concept.step = decodeStep(reader.readBytes());
      return true;
    }
    if (field === 2 && isWire(wireType, 2)) {
      concept.items.push(decodeItem(reader.readBytes()));
      return true;
    }
    if (field === 3 && isWire(wireType, 2)) {
      concept.result = decodeStepExecutionResult(reader.readBytes());
      return true;
    }
    return false;
  });
  return concept;
}

function decodeSpan(buffer) {
  const span = { start: 0 };
  decode(buffer, (field, wireType, reader) => {
    if (field === 1 && isWire(wireType, 0)) {
      span.start = reader.readVarint();
      return true;
    }
    return false;
  });
  return span;
}

function decodeScenario(buffer) {
  const scenario = {
    executionTime: 0,
    heading: "",
    items: [],
    skipErrors: [],
    status: 0,
    tearDownItems: [],
  };
  decode(buffer, (field, wireType, reader) => {
    if (field === 1 && isWire(wireType, 2)) {
      scenario.heading = reader.readString();
      return true;
    }
    if (field === 3 && isWire(wireType, 2)) {
      scenario.items.push(decodeItem(reader.readBytes()));
      return true;
    }
    if (field === 4 && isWire(wireType, 2)) {
      scenario.items.push(decodeItem(reader.readBytes()));
      return true;
    }
    if (field === 5 && isWire(wireType, 2)) {
      scenario.beforeHook = decodeHookFailure(reader.readBytes());
      return true;
    }
    if (field === 6 && isWire(wireType, 2)) {
      scenario.afterHook = decodeHookFailure(reader.readBytes());
      return true;
    }
    if (field === 8 && isWire(wireType, 0)) {
      scenario.executionTime = reader.readVarint();
      return true;
    }
    if (field === 10 && isWire(wireType, 2)) {
      scenario.skipErrors.push(reader.readString());
      return true;
    }
    if (field === 11 && isWire(wireType, 2)) {
      scenario.id = reader.readString();
      return true;
    }
    if (field === 12 && isWire(wireType, 2)) {
      scenario.tearDownItems.push(decodeItem(reader.readBytes()));
      return true;
    }
    if (field === 13 && isWire(wireType, 2)) {
      scenario.span = decodeSpan(reader.readBytes());
      return true;
    }
    if (field === 14 && isWire(wireType, 0)) {
      scenario.status = reader.readVarint();
      return true;
    }
    return false;
  });
  return scenario;
}

function decodeTableDrivenScenario(buffer) {
  const table = {
    isScenarioTableDriven: false,
    isSpecTableDriven: false,
    scenarioTableRowIndex: 0,
    tableRowIndex: 0,
  };
  decode(buffer, (field, wireType, reader) => {
    if (field === 1 && isWire(wireType, 2)) {
      table.scenario = decodeScenario(reader.readBytes());
      return true;
    }
    if (field === 2 && isWire(wireType, 0)) {
      table.tableRowIndex = reader.readVarint();
      return true;
    }
    if (field === 3 && isWire(wireType, 0)) {
      table.scenarioTableRowIndex = reader.readVarint();
      return true;
    }
    if (field === 4 && isWire(wireType, 0)) {
      table.isSpecTableDriven = Boolean(reader.readVarint());
      return true;
    }
    if (field === 5 && isWire(wireType, 0)) {
      table.isScenarioTableDriven = Boolean(reader.readVarint());
      return true;
    }
    return false;
  });
  return table;
}

function decodeItem(buffer) {
  const item = { itemType: 0 };
  decode(buffer, (field, wireType, reader) => {
    if (field === 1 && isWire(wireType, 0)) {
      item.itemType = reader.readVarint();
      return true;
    }
    if (field === 2 && isWire(wireType, 2)) {
      item.step = decodeStep(reader.readBytes());
      return true;
    }
    if (field === 3 && isWire(wireType, 2)) {
      item.concept = decodeConcept(reader.readBytes());
      return true;
    }
    if (field === 4 && isWire(wireType, 2)) {
      item.scenario = decodeScenario(reader.readBytes());
      return true;
    }
    if (field === 5 && isWire(wireType, 2)) {
      item.tableDrivenScenario = decodeTableDrivenScenario(reader.readBytes());
      return true;
    }
    if (field === 9 && isWire(wireType, 2)) {
      item.filename = reader.readString();
      return true;
    }
    return false;
  });
  return item;
}

function decodeSpec(buffer) {
  const spec = {
    afterHooks: [],
    beforeHooks: [],
    filename: "",
    heading: "",
    items: [],
  };
  decode(buffer, (field, wireType, reader) => {
    if (field === 1 && isWire(wireType, 2)) {
      spec.heading = reader.readString();
      return true;
    }
    if (field === 2 && isWire(wireType, 2)) {
      spec.items.push(decodeItem(reader.readBytes()));
      return true;
    }
    if (field === 4 && isWire(wireType, 2)) {
      spec.beforeHooks.push(decodeHookFailure(reader.readBytes()));
      return true;
    }
    if (field === 5 && isWire(wireType, 2)) {
      spec.afterHooks.push(decodeHookFailure(reader.readBytes()));
      return true;
    }
    if (field === 6 && isWire(wireType, 2)) {
      spec.filename = reader.readString();
      return true;
    }
    return false;
  });
  return spec;
}

function decodeSpecError(buffer) {
  const error = { filename: "", line: 0, message: "" };
  decode(buffer, (field, wireType, reader) => {
    if (field === 2 && isWire(wireType, 2)) {
      error.filename = reader.readString();
      return true;
    }
    if (field === 3 && isWire(wireType, 0)) {
      error.line = reader.readVarint();
      return true;
    }
    if (field === 4 && isWire(wireType, 2)) {
      error.message = reader.readString();
      return true;
    }
    return false;
  });
  return error;
}

function decodeSpecResult(buffer) {
  const result = { errors: [], failed: false, skipped: false };
  decode(buffer, (field, wireType, reader) => {
    if (field === 1 && isWire(wireType, 2)) {
      result.spec = decodeSpec(reader.readBytes());
      return true;
    }
    if (field === 4 && isWire(wireType, 0)) {
      result.failed = Boolean(reader.readVarint());
      return true;
    }
    if (field === 6 && isWire(wireType, 0)) {
      result.executionTime = reader.readVarint();
      return true;
    }
    if (field === 7 && isWire(wireType, 0)) {
      result.skipped = Boolean(reader.readVarint());
      return true;
    }
    if (field === 10 && isWire(wireType, 2)) {
      result.errors.push(decodeSpecError(reader.readBytes()));
      return true;
    }
    return false;
  });
  return result;
}

function decodeSuiteResult(buffer) {
  const result = { specResults: [] };
  decode(buffer, (field, wireType, reader) => {
    if (field === 1 && isWire(wireType, 2)) {
      result.specResults.push(decodeSpecResult(reader.readBytes()));
      return true;
    }
    if (field === 2 && isWire(wireType, 2)) {
      result.beforeHook = decodeHookFailure(reader.readBytes());
      return true;
    }
    if (field === 3 && isWire(wireType, 2)) {
      result.afterHook = decodeHookFailure(reader.readBytes());
      return true;
    }
    return false;
  });
  return result;
}

function failureMessage(label, failure) {
  const parts = [`Failed: ${label}`];
  if (failure && failure.errorMessage) {
    parts.push(`Message: ${failure.errorMessage}`);
  }
  if (failure && failure.stackTrace) {
    parts.push(`Stack Trace:\n${failure.stackTrace}`);
  }
  return parts.join("\n");
}

function hookEvents(failure, name, idPrefix, parentId, occurrence = 0, explicitId) {
  if (!failure) {
    return [];
  }
  const rowNumber = failure.tableRowIndex >= 0 ? failure.tableRowIndex + 1 : undefined;
  const rowSuffix = rowNumber === undefined ? "" : `:row:${rowNumber}`;
  const occurrenceSuffix = occurrence > 0 ? `:occurrence:${occurrence + 1}` : "";
  const id = explicitId || (rowNumber === undefined
    ? `${idPrefix || ""}${name}${occurrenceSuffix}`
    : `${idPrefix || ""}::hook:${name.toLowerCase().replaceAll(" ", "-")}${rowSuffix}${occurrenceSuffix}`);
  const displayName = rowNumber === undefined ? name : `${name} (row ${rowNumber})`;
  return [
    { type: "testStarted", id, parentId, name: displayName, resultOnly: true },
    {
      type: "testFailed",
      id,
      parentId,
      name: displayName,
      message: failureMessage(displayName, failure),
      resultOnly: true,
    },
    { type: "testFinished", id, parentId, name: displayName, resultOnly: true },
  ];
}

function suiteHookEvents(failure, name, projectRoot) {
  const id = projectRoot
    ? `${projectRoot}::hook:${name.toLowerCase().replaceAll(" ", "-")}`
    : undefined;
  return hookEvents(failure, name, "", ROOT_PARENT_ID, 0, id);
}

function hookFailureEvents(failures, name, idPrefix, parentId) {
  const occurrences = new Map();
  return failures.flatMap((failure) => {
    const rowKey = failure.tableRowIndex >= 0 ? failure.tableRowIndex : "none";
    const occurrence = occurrences.get(rowKey) || 0;
    occurrences.set(rowKey, occurrence + 1);
    return hookEvents(failure, name, idPrefix, parentId, occurrence);
  });
}

function stepFailureMessages(step, label) {
  if (!step || !step.result) {
    return [];
  }
  const messages = [];
  const stepLabel = step.actualText || label || "Step";
  if (step.result.beforeHook) {
    messages.push(failureMessage(`BeforeStep hook for step: ${stepLabel}`, step.result.beforeHook));
  }
  if (step.result.execution && step.result.execution.failed) {
    messages.push(failureMessage(stepLabel, step.result.execution));
  }
  if (step.result.afterHook) {
    messages.push(failureMessage(`AfterStep hook for step: ${stepLabel}`, step.result.afterHook));
  }
  return messages;
}

function itemFailureMessages(item) {
  if (!item) {
    return [];
  }
  if (item.step) {
    return stepFailureMessages(item.step);
  }
  if (item.concept) {
    return [
      ...stepFailureMessages(item.concept.step),
      ...item.concept.items.flatMap(itemFailureMessages),
    ];
  }
  return [];
}

function scenarioFailureMessage(scenario) {
  const messages = [];
  if (scenario.beforeHook) {
    messages.push(failureMessage("Before Scenario", scenario.beforeHook));
  }
  messages.push(...scenario.items.flatMap(itemFailureMessages));
  messages.push(...scenario.tearDownItems.flatMap(itemFailureMessages));
  if (scenario.afterHook) {
    messages.push(failureMessage("After Scenario", scenario.afterHook));
  }
  return messages.join("\n\n") || "Scenario failed.";
}

function scenarioInfo(item, filename) {
  const table = item.tableDrivenScenario;
  const scenario = item.scenario || (table && table.scenario);
  if (!scenario) {
    return undefined;
  }
  let id = scenario.id || `${filename}:${scenario.span ? scenario.span.start : 0}`;
  let name = scenario.heading || id;
  if (table && (table.isScenarioTableDriven || table.isSpecTableDriven)) {
    const row = table.isScenarioTableDriven
      ? table.scenarioTableRowIndex
      : table.tableRowIndex;
    id = `${id}_${row + 1}`;
    name = `${name}_${row + 1}`;
  }
  return { id, name, scenario };
}

function scenarioEvents(item, filename) {
  const info = scenarioInfo(item, filename);
  if (!info || info.scenario.status === 0) {
    return [];
  }
  const event = {
    id: info.id,
    parentId: filename,
    name: info.name,
    ...(item.tableDrivenScenario ? { resultOnly: true } : {}),
  };
  // Gauge reports the scenario heading line, which is what the Test Results
  // panel needs to link a result back to its source.
  const span = info.scenario.span;
  const location = filename && span && span.start
    ? { location: `gauge://${filename}:${span.start}` }
    : {};
  const events = [];
  if (info.scenario.status === 2) {
    events.push({
      type: "testFailed",
      ...event,
      ...location,
      message: scenarioFailureMessage(info.scenario),
    });
  } else if (info.scenario.status === 3) {
    events.push({
      type: "testIgnored",
      ...event,
      ...location,
      message: info.scenario.skipErrors.join("\n"),
    });
  }
  events.push({
    type: "testFinished",
    ...event,
    duration: info.scenario.executionTime,
  });
  return events;
}

function normalizedDiagnostic(message) {
  return String(message || "").trim().replaceAll(/\s+/g, " ");
}

function specFallbackEvents(result, filename, hasExplainingLeaf, representedErrors = []) {
  const represented = new Set(representedErrors.map(normalizedDiagnostic));
  const errors = result.errors.filter((error) => (
    !represented.has(normalizedDiagnostic(error.message))
  ));
  const hasSpecificationErrors = errors.length > 0;
  if (
    !hasSpecificationErrors
    && (hasExplainingLeaf || (!result.failed && !result.skipped))
  ) {
    return [];
  }
  const name = hasSpecificationErrors
    ? "Specification Errors"
    : (result.skipped ? "Ignored" : "Failed");
  const id = hasSpecificationErrors
    ? `${filename}::result:specification-errors`
    : `${filename}${name}`;
  const message = errors.map((error) => {
    const location = error.filename
      ? `${error.filename}${error.line ? `:${error.line}` : ""}\n`
      : "";
    return `${location}${error.message}`.trim();
  }).filter(Boolean).join("\n\n") || " ";
  const locatedError = errors.find((error) => error.filename && error.line > 0);
  const location = locatedError
    ? `gauge://${locatedError.filename}:${locatedError.line}`
    : undefined;
  return [
    { type: "testStarted", id, parentId: filename, name, resultOnly: true },
    {
      type: hasSpecificationErrors
        ? "testErrored"
        : (result.skipped ? "testIgnored" : "testFailed"),
      id,
      parentId: filename,
      name,
      message,
      ...(location ? { location } : {}),
      resultOnly: true,
    },
    { type: "testFinished", id, parentId: filename, name, resultOnly: true },
  ];
}

function executionEventsFromLastRunResult(buffer, options = {}) {
  const suite = decodeSuiteResult(buffer);
  const events = [
    ...suiteHookEvents(suite.beforeHook, "Before Suite", options.projectRoot),
  ];
  for (const result of suite.specResults) {
    if (!result.spec || !result.spec.filename) {
      continue;
    }
    const filename = result.spec.filename;
    events.push(...hookFailureEvents(
      result.spec.beforeHooks,
      "Before Specification",
      filename,
      filename,
    ));
    let hasFailedScenario = false;
    let hasSkippedScenario = false;
    const representedErrors = [];
    for (const item of result.spec.items) {
      const info = scenarioInfo(item, filename);
      const itemEvents = scenarioEvents(item, filename);
      if (info && info.scenario.status === 2) {
        hasFailedScenario = true;
      } else if (info && info.scenario.status === 3) {
        hasSkippedScenario = true;
        representedErrors.push(...info.scenario.skipErrors);
      }
      events.push(...itemEvents);
    }
    events.push(...hookFailureEvents(
      result.spec.afterHooks,
      "After Specification",
      filename,
      filename,
    ));
    const hasHookFailures = result.spec.beforeHooks.length > 0
      || result.spec.afterHooks.length > 0;
    events.push(...specFallbackEvents(
      result,
      filename,
      hasHookFailures || (result.skipped ? hasSkippedScenario : hasFailedScenario),
      representedErrors,
    ));
  }
  events.push(...suiteHookEvents(suite.afterHook, "After Suite", options.projectRoot));
  return events;
}

function lastRunResultPath(projectRoot, pathModule = nodePath) {
  return pathModule.join(projectRoot, ...LAST_RUN_RESULT_PATH);
}

function lastRunResultStamp(projectRoot, options = {}) {
  const fs = options.fs || nodeFs;
  const path = lastRunResultPath(projectRoot, options.pathModule);
  try {
    const stat = fs.statSync(path);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch (_error) {
    return undefined;
  }
}

function readNewLastRunResultEvents(projectRoot, previousStamp, options = {}) {
  const fs = options.fs || nodeFs;
  const path = lastRunResultPath(projectRoot, options.pathModule);
  const nextStamp = lastRunResultStamp(projectRoot, options);
  if (!nextStamp || nextStamp === previousStamp) {
    return [];
  }
  return executionEventsFromLastRunResult(fs.readFileSync(path), { projectRoot });
}

module.exports = {
  executionEventsFromLastRunResult,
  lastRunResultStamp,
  readNewLastRunResultEvents,
};
