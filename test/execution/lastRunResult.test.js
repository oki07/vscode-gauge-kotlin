const assert = require("node:assert/strict");
const test = require("node:test");

function varint(value) {
  const bytes = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (remaining > 0);
  return Buffer.from(bytes);
}

function fieldVarint(field, value) {
  return Buffer.concat([varint(field << 3), varint(value)]);
}

function signedInt32Varint(value) {
  const bytes = [];
  let remaining = BigInt.asUintN(64, BigInt(value));
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining > 0n) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (remaining > 0n);
  return Buffer.from(bytes);
}

function fieldInt32(field, value) {
  return Buffer.concat([varint(field << 3), signedInt32Varint(value)]);
}

function fieldBytes(field, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return Buffer.concat([varint((field << 3) | 2), varint(bytes.length), bytes]);
}

function message(...fields) {
  return Buffer.concat(fields);
}

function scenarioItem(
  heading,
  line,
  status,
  executionTime,
  stepError,
  afterScenarioError,
  beforeStepError,
) {
  const scenarioFields = [
    fieldBytes(1, heading),
    fieldVarint(8, executionTime),
    fieldBytes(13, fieldVarint(1, line)),
    fieldVarint(14, status),
  ];
  if (stepError) {
    const executionResult = message(
      fieldVarint(1, 1),
      fieldBytes(3, stepError),
      fieldBytes(4, "stack line"),
    );
    const stepResultFields = [fieldBytes(1, executionResult)];
    if (beforeStepError) {
      stepResultFields.push(fieldBytes(2, message(
        fieldBytes(1, "before step stack"),
        fieldBytes(2, beforeStepError),
      )));
    }
    const stepResult = message(...stepResultFields);
    const step = message(fieldBytes(1, "Failing step"), fieldBytes(4, stepResult));
    const stepItem = message(fieldBytes(2, step));
    scenarioFields.push(fieldBytes(4, stepItem));
  }
  if (afterScenarioError) {
    const afterScenario = message(
      fieldBytes(1, "after scenario stack"),
      fieldBytes(2, afterScenarioError),
    );
    scenarioFields.push(fieldBytes(6, afterScenario));
  }
  const scenario = message(...scenarioFields);
  return message(fieldVarint(1, 3), fieldBytes(4, scenario));
}

function skippedScenarioItem(heading, line, reason) {
  const scenario = message(
    fieldBytes(1, heading),
    fieldVarint(8, 4),
    fieldBytes(10, reason),
    fieldBytes(13, fieldVarint(1, line)),
    fieldVarint(14, 3),
  );
  return message(fieldVarint(1, 3), fieldBytes(4, scenario));
}

function tableScenarioItem(heading, line, rowIndex) {
  const scenario = message(
    fieldBytes(1, heading),
    fieldVarint(8, 7),
    fieldBytes(13, fieldVarint(1, line)),
    fieldVarint(14, 1),
  );
  const tableScenario = message(
    fieldBytes(1, scenario),
    fieldVarint(3, rowIndex),
    fieldVarint(5, 1),
  );
  return message(fieldVarint(1, 4), fieldBytes(5, tableScenario));
}

// A nested table run is N_spec x N_scenario executions and the proto carries both
// indices (getgauge/gauge/execution/result/specResult.go sets
// IsSpecTableDriven and, for a nested scenario, IsScenarioTableDriven with
// ScenarioTableRowIndex). Keying on the scenario index alone collapsed the spec
// rows onto each other, so half the results were overwritten - and when the
// failures arrived first every surviving item ended green while Gauge exited
// non-zero.
test("last run result keeps nested table rows distinct", () => {
  const { executionEventsFromLastRunResult } = require("../../src/execution/lastRunResult");
  const filename = "/workspace/specs/nested.spec";
  const nestedItem = (specRow, scenarioRow) => {
    const scenario = message(
      fieldBytes(1, "Row"),
      fieldVarint(8, 7),
      fieldBytes(13, fieldVarint(1, 8)),
      fieldVarint(14, 1),
    );
    // Field numbers per decodeTableDrivenScenario in the product:
    // 1 scenario, 2 tableRowIndex, 3 scenarioTableRowIndex,
    // 4 isSpecTableDriven, 5 isScenarioTableDriven.
    const tableScenario = message(
      fieldBytes(1, scenario),
      fieldVarint(2, specRow),
      fieldVarint(3, scenarioRow),
      fieldVarint(4, 1),
      fieldVarint(5, 1),
    );
    return message(fieldVarint(1, 4), fieldBytes(5, tableScenario));
  };
  const spec = message(
    fieldBytes(1, "Nested"),
    fieldBytes(2, nestedItem(0, 0)),
    fieldBytes(2, nestedItem(0, 1)),
    fieldBytes(2, nestedItem(1, 0)),
    fieldBytes(2, nestedItem(1, 1)),
    fieldBytes(6, filename),
  );
  const suiteResult = fieldBytes(1, message(fieldBytes(1, spec)));

  const ids = executionEventsFromLastRunResult(suiteResult)
    .filter((event) => event.type === "testFinished")
    .map((event) => event.id);

  assert.equal(new Set(ids).size, 4, JSON.stringify(ids));
});

test("last run result maps Gauge protobuf scenarios and hook failures to leaf events", () => {
  const { executionEventsFromLastRunResult } = require("../../src/execution/lastRunResult");
  const filename = "/workspace/specs/example.spec";
  const beforeSpec = message(
    fieldBytes(1, "spec stack"),
    fieldBytes(2, "spec setup failed"),
    fieldInt32(4, -1),
  );
  const afterSuite = message(
    fieldBytes(1, "suite stack"),
    fieldBytes(2, "suite cleanup failed"),
  );
  const spec = message(
    fieldBytes(1, "Checkout"),
    fieldBytes(2, scenarioItem("Passing", 3, 1, 42)),
    fieldBytes(2, scenarioItem(
      "Failing",
      10,
      2,
      9,
      "boom",
      "cleanup boom",
      "setup boom",
    )),
    fieldBytes(4, beforeSpec),
    fieldBytes(6, filename),
  );
  const specResult = message(
    fieldBytes(1, spec),
    fieldVarint(4, 1),
    fieldVarint(6, 51),
  );
  const suiteResult = message(fieldBytes(1, specResult), fieldBytes(3, afterSuite));

  assert.deepEqual(executionEventsFromLastRunResult(suiteResult), [
    {
      type: "testStarted",
      id: `${filename}Before Specification`,
      parentId: filename,
      name: "Before Specification",
      resultOnly: true,
    },
    {
      type: "testFailed",
      id: `${filename}Before Specification`,
      parentId: filename,
      name: "Before Specification",
      message: "Failed: Before Specification\nMessage: spec setup failed\nStack Trace:\nspec stack",
      resultOnly: true,
    },
    {
      type: "testFinished",
      id: `${filename}Before Specification`,
      parentId: filename,
      name: "Before Specification",
      resultOnly: true,
    },
    {
      type: "testFinished",
      id: `${filename}:3`,
      parentId: filename,
      name: "Passing",
      duration: 42,
    },
    {
      type: "testFailed",
      id: `${filename}:10`,
      parentId: filename,
      name: "Failing",
      location: `gauge://${filename}:10`,
      message: [
        [
          "Failed: BeforeStep hook for step: Failing step",
          "Message: setup boom",
          "Stack Trace:",
          "before step stack",
        ].join("\n"),
        "Failed: Failing step\nMessage: boom\nStack Trace:\nstack line",
        "Failed: After Scenario\nMessage: cleanup boom\nStack Trace:\nafter scenario stack",
      ].join("\n\n"),
    },
    {
      type: "testFinished",
      id: `${filename}:10`,
      parentId: filename,
      name: "Failing",
      duration: 9,
    },
    {
      type: "testStarted",
      id: "After Suite",
      parentId: "suite",
      name: "After Suite",
      resultOnly: true,
    },
    {
      type: "testFailed",
      id: "After Suite",
      parentId: "suite",
      name: "After Suite",
      message: "Failed: After Suite\nMessage: suite cleanup failed\nStack Trace:\nsuite stack",
      resultOnly: true,
    },
    {
      type: "testFinished",
      id: "After Suite",
      parentId: "suite",
      name: "After Suite",
      resultOnly: true,
    },
  ]);
});

test("last run result namespaces suite hook leaves by Gauge project root", () => {
  const { executionEventsFromLastRunResult } = require("../../src/execution/lastRunResult");
  const beforeSuite = message(fieldBytes(2, "suite setup failed"));
  const suiteResult = fieldBytes(2, beforeSuite);

  const shopEvents = executionEventsFromLastRunResult(suiteResult, {
    projectRoot: "/workspace/shop",
  });
  const adminEvents = executionEventsFromLastRunResult(suiteResult, {
    projectRoot: "/workspace/admin",
  });

  assert.deepEqual([
    shopEvents[0].id,
    adminEvents[0].id,
  ], [
    "/workspace/shop::hook:before-suite",
    "/workspace/admin::hook:before-suite",
  ]);
});

test("last run result does not duplicate a specification hook failure", () => {
  const { executionEventsFromLastRunResult } = require("../../src/execution/lastRunResult");
  const filename = "/workspace/specs/setup.spec";
  // getgauge/gauge/execution/result/result.go GetProtoHookFailure always sets
  // TableRowIndex to -1, and only the table-driven merge path in
  // getgauge/gauge/execution/merge.go addHookFailure overwrites it. -1 is
  // non-zero, so gauge always puts it on the wire for a non-table hook failure.
  const beforeSpec = message(
    fieldBytes(1, "spec stack"),
    fieldBytes(2, "spec setup failed"),
    fieldInt32(4, -1),
  );
  const spec = message(
    fieldBytes(1, "Setup"),
    fieldBytes(4, beforeSpec),
    fieldBytes(6, filename),
  );
  const suiteResult = fieldBytes(1, message(fieldBytes(1, spec), fieldVarint(4, 1)));

  assert.deepEqual(executionEventsFromLastRunResult(suiteResult), [
    {
      type: "testStarted",
      id: `${filename}Before Specification`,
      parentId: filename,
      name: "Before Specification",
      resultOnly: true,
    },
    {
      type: "testFailed",
      id: `${filename}Before Specification`,
      parentId: filename,
      name: "Before Specification",
      message: "Failed: Before Specification\nMessage: spec setup failed\nStack Trace:\nspec stack",
      resultOnly: true,
    },
    {
      type: "testFinished",
      id: `${filename}Before Specification`,
      parentId: filename,
      name: "Before Specification",
      resultOnly: true,
    },
  ]);
});

test("last run result keeps table-driven specification hook failures distinct by row", () => {
  const { executionEventsFromLastRunResult } = require("../../src/execution/lastRunResult");
  const filename = "/workspace/specs/table-hooks.spec";
  // TableRowIndex is a proto3 int32 (getgauge/gauge-proto/spec.proto), so
  // protobuf-go omits the field entirely when the value is 0 - which is exactly
  // the FIRST data-table row. Reading an absent field as "not table driven"
  // labelled row 1 as a bare "Before Specification" next to its "(row 2)"
  // sibling and keyed it with the legacy id shape.
  const hookFailure = (rowIndex, messageText) => (rowIndex === 0
    ? message(fieldBytes(2, messageText))
    : message(fieldBytes(2, messageText), fieldInt32(4, rowIndex)));
  // getgauge/gauge/execution/merge.go mergeResults sets IsTableDriven on the
  // very spec whose hooks addHookFailure gives row indices to, so it is the
  // signal that tells an absent TableRowIndex (row 0) from a hook that belongs
  // to no table (an explicit -1).
  const spec = message(
    fieldBytes(1, "Table hooks"),
    fieldVarint(3, 1),
    fieldBytes(4, hookFailure(0, "first row setup failed")),
    fieldBytes(4, hookFailure(1, "second row setup failed")),
    fieldBytes(6, filename),
  );
  const suiteResult = fieldBytes(1, message(fieldBytes(1, spec), fieldVarint(4, 1)));

  const started = executionEventsFromLastRunResult(suiteResult)
    .filter((event) => event.type === "testStarted");
  assert.deepEqual(started.map(({ id, name }) => ({ id, name })), [
    {
      id: `${filename}::hook:before-specification:row:1`,
      name: "Before Specification (row 1)",
    },
    {
      id: `${filename}::hook:before-specification:row:2`,
      name: "Before Specification (row 2)",
    },
  ]);
});

test("last run result preserves unexplained specification failures alongside passing scenarios", () => {
  const { executionEventsFromLastRunResult } = require("../../src/execution/lastRunResult");
  const filename = "/workspace/specs/validation.spec";
  const spec = message(
    fieldBytes(1, "Validation"),
    fieldBytes(2, scenarioItem("Passing", 3, 1, 12)),
    fieldBytes(6, filename),
  );
  const specError = message(
    fieldBytes(2, filename),
    fieldVarint(3, 8),
    fieldBytes(4, "Specification validation failed"),
  );
  const specResult = message(
    fieldBytes(1, spec),
    fieldVarint(4, 1),
    fieldBytes(10, specError),
  );
  const suiteResult = fieldBytes(1, specResult);

  assert.deepEqual(executionEventsFromLastRunResult(suiteResult), [
    {
      type: "testFinished",
      id: `${filename}:3`,
      parentId: filename,
      name: "Passing",
      duration: 12,
    },
    {
      type: "testStarted",
      id: `${filename}::result:specification-errors`,
      parentId: filename,
      name: "Specification Errors",
      resultOnly: true,
    },
    {
      type: "testErrored",
      id: `${filename}::result:specification-errors`,
      parentId: filename,
      name: "Specification Errors",
      message: `${filename}:8\nSpecification validation failed`,
      location: `gauge://${filename}:8`,
      resultOnly: true,
    },
    {
      type: "testFinished",
      id: `${filename}::result:specification-errors`,
      parentId: filename,
      name: "Specification Errors",
      resultOnly: true,
    },
  ]);
});

test("last run result preserves independent specification errors alongside failed scenarios", () => {
  const { executionEventsFromLastRunResult } = require("../../src/execution/lastRunResult");
  const filename = "/workspace/specs/mixed-failures.spec";
  const spec = message(
    fieldBytes(1, "Mixed failures"),
    fieldBytes(2, scenarioItem("Broken scenario", 3, 2, 5, "scenario boom")),
    fieldBytes(6, filename),
  );
  const specError = message(
    fieldBytes(2, filename),
    fieldVarint(3, 9),
    fieldBytes(4, "Independent validation error"),
  );
  const specResult = message(
    fieldBytes(1, spec),
    fieldVarint(4, 1),
    fieldBytes(10, specError),
  );

  const failures = executionEventsFromLastRunResult(fieldBytes(1, specResult))
    .filter((event) => event.type === "testFailed" || event.type === "testErrored");
  assert.deepEqual(failures.map(({ id, type }) => ({ id, type })), [
    { id: `${filename}:3`, type: "testFailed" },
    { id: `${filename}::result:specification-errors`, type: "testErrored" },
  ]);
});

test("last run result does not duplicate a spec error already shown by a skipped scenario", () => {
  const { executionEventsFromLastRunResult } = require("../../src/execution/lastRunResult");
  const filename = "/workspace/specs/skipped.spec";
  const spec = message(
    fieldBytes(1, "Skipped"),
    fieldBytes(2, skippedScenarioItem("Filtered scenario", 4, "filtered by tag")),
    fieldBytes(6, filename),
  );
  const specError = message(
    fieldBytes(2, filename),
    fieldVarint(3, 4),
    fieldBytes(4, "filtered by tag"),
  );
  const specResult = message(
    fieldBytes(1, spec),
    fieldVarint(7, 1),
    fieldBytes(10, specError),
  );

  const resultEvents = executionEventsFromLastRunResult(fieldBytes(1, specResult))
    .filter((event) => event.type === "testFailed"
      || event.type === "testErrored"
      || event.type === "testIgnored");
  assert.deepEqual(resultEvents.map(({ id, type }) => ({ id, type })), [
    { id: `${filename}:4`, type: "testIgnored" },
  ]);
});

test("last run result maps skipped and table-driven scenarios", () => {
  const { executionEventsFromLastRunResult } = require("../../src/execution/lastRunResult");
  const filename = "/workspace/specs/table.spec";
  const spec = message(
    fieldBytes(1, "Table"),
    fieldBytes(2, skippedScenarioItem("Skipped", 4, "filtered")),
    fieldBytes(2, tableScenarioItem("Row", 12, 1)),
    fieldBytes(6, filename),
  );
  const suiteResult = fieldBytes(1, message(fieldBytes(1, spec)));

  assert.deepEqual(executionEventsFromLastRunResult(suiteResult), [
    {
      type: "testIgnored",
      id: `${filename}:4`,
      parentId: filename,
      name: "Skipped",
      location: `gauge://${filename}:4`,
      message: "filtered",
    },
    {
      type: "testFinished",
      id: `${filename}:4`,
      parentId: filename,
      name: "Skipped",
      duration: 4,
    },
    {
      type: "testFinished",
      id: `${filename}:12_2`,
      parentId: filename,
      name: "Row_2",
      resultOnly: true,
      duration: 7,
    },
  ]);
});

test("last run result explains a failed specification that carries no errors", () => {
  const { executionEventsFromLastRunResult } = require("../../src/execution/lastRunResult");
  const filename = "/workspace/specs/example.spec";
  const spec = message(
    fieldBytes(1, "Example"),
    fieldBytes(6, filename),
    fieldVarint(9, 1),
  );
  const suiteResult = fieldBytes(1, message(fieldBytes(1, spec), fieldVarint(4, 1)));

  const failures = executionEventsFromLastRunResult(suiteResult)
    .filter((event) => event.type === "testFailed");

  assert.deepEqual(failures.map((event) => event.message), ["Specification failed."]);
});
