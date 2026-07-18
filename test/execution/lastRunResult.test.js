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

test("last run result maps Gauge protobuf scenarios and hook failures to leaf events", () => {
  const { executionEventsFromLastRunResult } = require("../../src/execution/lastRunResult");
  const filename = "/workspace/specs/example.spec";
  const beforeSpec = message(
    fieldBytes(1, "spec stack"),
    fieldBytes(2, "spec setup failed"),
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
    },
    {
      type: "testFailed",
      id: `${filename}Before Specification`,
      parentId: filename,
      name: "Before Specification",
      message: "Failed: Before Specification\nMessage: spec setup failed\nStack Trace:\nspec stack",
    },
    {
      type: "testFinished",
      id: `${filename}Before Specification`,
      parentId: filename,
      name: "Before Specification",
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
    },
    {
      type: "testFailed",
      id: "After Suite",
      parentId: "suite",
      name: "After Suite",
      message: "Failed: After Suite\nMessage: suite cleanup failed\nStack Trace:\nsuite stack",
    },
    {
      type: "testFinished",
      id: "After Suite",
      parentId: "suite",
      name: "After Suite",
    },
  ]);
});

test("last run result does not duplicate a specification hook failure", () => {
  const { executionEventsFromLastRunResult } = require("../../src/execution/lastRunResult");
  const filename = "/workspace/specs/setup.spec";
  const beforeSpec = message(
    fieldBytes(1, "spec stack"),
    fieldBytes(2, "spec setup failed"),
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
    },
    {
      type: "testFailed",
      id: `${filename}Before Specification`,
      parentId: filename,
      name: "Before Specification",
      message: "Failed: Before Specification\nMessage: spec setup failed\nStack Trace:\nspec stack",
    },
    {
      type: "testFinished",
      id: `${filename}Before Specification`,
      parentId: filename,
      name: "Before Specification",
    },
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
      duration: 7,
    },
  ]);
});
