const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { createGaugeProcessRunner } = require("../../src/execution/processRunner");
const { CLI } = require("../../src/cli");

// Node child-process pipes emit Buffer chunks whose boundaries need not coincide
// with UTF-8 characters. Every output consumer must preserve the same text.
for (const route of ["execution", "installation"]) {
  for (const stream of ["stdout", "stderr"]) {
    test(`${route} ${stream} preserves split UTF-8 in displayed output`, async () => {
      const text = "message \u00e9 \u2713 \ud83d\ude00";
      const payload = Buffer.from(text + "\n");
      for (let cut = 1; cut < payload.length; cut++) {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        const lines = [];
        const forwarded = [];
        const channel = { appendLine: line => lines.push(line), clear() {}, show() {} };
        let run;
        if (route === "execution") {
          run = createGaugeProcessRunner({
            outputChannel: channel, spawn: () => child,
            processOutputChunk: chunk => forwarded.push(chunk),
          })({ command: "gauge", args: ["run"], cwd: "/workspace", forwardOutput: true });
        } else {
          const cli = new CLI({ spawn: () => child }, {}, {});
          run = cli.installGaugeRunner("java", {
            vscode: { window: { createOutputChannel: () => channel } },
          });
        }
        child[stream].emit("data", payload.subarray(0, cut));
        child[stream].emit("data", payload.subarray(cut));
        child.emit("exit", 1);
        child.emit("close", 1);
        await run;
        assert.ok(lines.includes(text), `cut ${cut}: ${JSON.stringify(lines)}`);
        if (route === "execution") assert.equal(forwarded.join(""), text + "\n");
      }
    });
  }
}

test("output decoders keep streams separate and flush an incomplete final character", () => {
  const { OutputChannel } = require("../../src/execution/outputChannel");
  const lines = [];
  const channel = new OutputChannel({ appendLine: line => lines.push(line), clear() {}, show() {} }, "", "");
  const encoded = Buffer.from("\u2713");
  channel.appendOutBuf(encoded.subarray(0, 1));
  channel.appendErrBuf(Buffer.from("warning\n"));
  channel.appendOutBuf(encoded.subarray(1));
  channel.appendErrBuf(Buffer.from([0xe2]));
  channel.onFinish(() => {}, 1, "success", "failure", false);
  assert.deepEqual(lines, ["", "warning", "\u2713", "\ufffd", "failure"]);
});
