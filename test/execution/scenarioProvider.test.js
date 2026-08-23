const assert = require("node:assert/strict");
const test = require("node:test");

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function installCancellationSources(vscode, onConstructed) {
  const sources = [];
  vscode.CancellationTokenSource = class CancellationTokenSource {
    constructor() {
      this.cancelCalls = 0;
      this.disposeCalls = 0;
      this.token = { source: this };
      sources.push(this);
      if (onConstructed) {
        onConstructed(this);
      }
    }

    cancel() {
      this.cancelCalls += 1;
    }

    dispose() {
      this.disposeCalls += 1;
    }
  };
  return sources;
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createFakeVscode(overrides = {}) {
  return {
    CancellationTokenSource: class CancellationTokenSource {
      constructor() {
        this.token = { cancelled: false };
      }
    },
    Position: class Position {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
    },
    window: {
      activeTextEditor: overrides.activeTextEditor || {
        selection: { active: { line: 8, character: 2 } },
        document: {
          uri: {
            fsPath: "/workspace/specs/example.spec",
            toString() {
              return "file:///workspace/specs/example.spec";
            },
          },
        },
      },
    },
  };
}

function createClient(calls, response) {
  return {
    started: 0,
    start() {
      this.started += 1;
      return Promise.resolve(undefined);
    },
    sendRequest(method, params, token) {
      calls.push({ method, params, token });
      return Promise.resolve(response);
    },
  };
}

test("Gauge scenario provider requests the scenario at the active cursor", async () => {
  const { createGaugeScenariosProvider } = require("../../src/execution/scenarioProvider");
  const calls = [];
  const response = {
    heading: "Checkout order",
    executionIdentifier: "/workspace/specs/example.spec:8",
  };
  const client = createClient(calls, response);
  const clients = {
    get(fsPath) {
      assert.equal(fsPath, "/workspace/specs/example.spec");
      return { client };
    },
  };
  const vscode = createFakeVscode();
  const provider = createGaugeScenariosProvider(clients, { vscode });

  const result = await provider({
    atCursor: true,
    position: { line: 8, character: 2 },
    spec: "/workspace/specs/example.spec",
  });

  assert.equal(client.started, 1);
  assert.equal(result, response);
  assert.deepEqual(calls, [
    {
      method: "gauge/scenarios",
      params: {
        textDocument: { uri: "file:///workspace/specs/example.spec" },
        position: { line: 8, character: 2 },
      },
      token: { cancelled: false },
    },
  ]);
});

test("Gauge scenario provider requests all scenarios from the document start", async () => {
  const { createGaugeScenariosProvider } = require("../../src/execution/scenarioProvider");
  const calls = [];
  const response = [
    {
      heading: "First",
      executionIdentifier: "/workspace/specs/example.spec:4",
    },
  ];
  const client = createClient(calls, response);
  const vscode = createFakeVscode();
  const provider = createGaugeScenariosProvider(() => ({
    get() {
      return { client };
    },
  }), { vscode });

  const result = await provider({
    atCursor: false,
    position: { line: 8, character: 2 },
    spec: "/workspace/specs/example.spec",
  });

  assert.equal(result, response);
  assert.deepEqual(calls[0].params, {
    textDocument: { uri: "file:///workspace/specs/example.spec" },
    position: { line: 1, character: 1 },
  });
});

test("Gauge scenario provider rejects when no client exists for the specification", async () => {
  const { createGaugeScenariosProvider } = require("../../src/execution/scenarioProvider");
  const vscode = createFakeVscode();
  const provider = createGaugeScenariosProvider({
    get() {
      return undefined;
    },
  }, { vscode });

  await assert.rejects(
    () => provider({
      atCursor: true,
      position: { line: 8, character: 2 },
      spec: "/workspace/specs/example.spec",
    }),
    /No Gauge language client available for \/workspace\/specs\/example\.spec/,
  );
});

test("Gauge scenario provider does not request scenarios when client start completes after disposal", async () => {
  const { createGaugeScenariosProvider } = require("../../src/execution/scenarioProvider");
  const startEntered = deferred();
  const releaseStart = deferred();
  const requestCalls = [];
  const provider = createGaugeScenariosProvider({
    get() {
      return {
        client: {
          start() {
            startEntered.resolve();
            return releaseStart.promise;
          },
          sendRequest(...args) {
            requestCalls.push(args);
            return Promise.resolve([{ heading: "Late scenario" }]);
          },
        },
      };
    },
  }, { vscode: createFakeVscode() });

  const lookup = provider({
    atCursor: false,
    spec: "/workspace/specs/example.spec",
  });
  await startEntered.promise;

  const hasDispose = typeof provider.dispose === "function";
  if (hasDispose) {
    provider.dispose();
    provider.dispose();
  }
  let outcome = { status: "pending" };
  lookup.then(
    (value) => {
      outcome = { status: "fulfilled", value };
    },
    (error) => {
      outcome = { error, status: "rejected" };
    },
  );
  await nextTurn();
  const outcomeBeforeRelease = outcome;
  releaseStart.resolve();
  const result = await lookup;

  assert.deepEqual({
    hasDispose,
    outcomeBeforeRelease,
    requestCalls: requestCalls.length,
    result,
  }, {
    hasDispose: true,
    outcomeBeforeRelease: { status: "fulfilled", value: undefined },
    requestCalls: 0,
    result: undefined,
  });
});

test("Gauge scenario provider observes client start failures after disposal", async () => {
  const { createGaugeScenariosProvider } = require("../../src/execution/scenarioProvider");
  const startEntered = deferred();
  const releaseStart = deferred();
  const vscode = createFakeVscode();
  const sources = installCancellationSources(vscode);
  let requestCalls = 0;
  const provider = createGaugeScenariosProvider({
    get() {
      return {
        client: {
          start() {
            startEntered.resolve();
            return releaseStart.promise;
          },
          sendRequest() {
            requestCalls += 1;
            return Promise.resolve([]);
          },
        },
      };
    },
  }, { vscode });

  const lookup = provider({ spec: "/workspace/specs/example.spec" });
  await startEntered.promise;
  provider.dispose();

  assert.equal(await lookup, undefined);
  releaseStart.reject(new Error("late client start failure"));
  await nextTurn();

  assert.equal(requestCalls, 0);
  assert.deepEqual(sources, []);
});

test("Gauge scenario provider releases request sources on live success and failure", async () => {
  const { createGaugeScenariosProvider } = require("../../src/execution/scenarioProvider");
  const response = [{ heading: "Checkout order" }];
  const requestError = new Error("scenario request failed");

  for (const outcome of ["success", "failure"]) {
    const vscode = createFakeVscode();
    const sources = installCancellationSources(vscode);
    const tokens = [];
    const provider = createGaugeScenariosProvider({
      get() {
        return {
          client: {
            start() {
              return Promise.resolve(undefined);
            },
            sendRequest(_method, _params, token) {
              tokens.push(token);
              return outcome === "success"
                ? Promise.resolve(response)
                : Promise.reject(requestError);
            },
          },
        };
      },
    }, { vscode });

    const invocation = provider({
      atCursor: false,
      spec: "/workspace/specs/example.spec",
    });
    if (outcome === "success") {
      assert.equal(await invocation, response);
    } else {
      await assert.rejects(invocation, (error) => error === requestError);
    }

    assert.equal(tokens[0], sources[0].token);
    assert.deepEqual(sources.map((source) => ({
      cancelCalls: source.cancelCalls,
      disposeCalls: source.disposeCalls,
    })), [{ cancelCalls: 0, disposeCalls: 1 }]);
  }
});

test("Gauge scenario provider observes late request failures after disposal", async () => {
  const { createGaugeScenariosProvider } = require("../../src/execution/scenarioProvider");
  const requestEntered = deferred();
  const request = deferred();
  const vscode = createFakeVscode();
  const sources = installCancellationSources(vscode);
  let requestCalls = 0;
  const provider = createGaugeScenariosProvider({
    get() {
      return {
        client: {
          start() {
            return Promise.resolve(undefined);
          },
          sendRequest() {
            requestCalls += 1;
            requestEntered.resolve();
            return request.promise;
          },
        },
      };
    },
  }, { vscode });

  const invocation = provider({
    atCursor: false,
    spec: "/workspace/specs/example.spec",
  });
  await requestEntered.promise;
  sources[0].cancel = function cancelWithFailure() {
    this.cancelCalls += 1;
    throw new Error("cancel failed");
  };
  assert.doesNotThrow(() => provider.dispose());
  provider.dispose();

  assert.equal(await invocation, undefined);
  request.reject(new Error("late scenario request failure"));
  await nextTurn();
  assert.equal(await provider({ spec: "/workspace/specs/example.spec" }), undefined);

  assert.equal(requestCalls, 1);
  assert.deepEqual(sources.map((source) => ({
    cancelCalls: source.cancelCalls,
    disposeCalls: source.disposeCalls,
  })), [{ cancelCalls: 1, disposeCalls: 1 }]);
});

test("Gauge scenario provider closes a request source created during synchronous disposal", async () => {
  const { createGaugeScenariosProvider } = require("../../src/execution/scenarioProvider");
  const vscode = createFakeVscode();
  let provider;
  const sources = installCancellationSources(vscode, () => provider.dispose());
  let requestCalls = 0;
  provider = createGaugeScenariosProvider({
    get() {
      return {
        client: {
          start() {
            return Promise.resolve(undefined);
          },
          sendRequest() {
            requestCalls += 1;
            return Promise.reject(new Error("request should not start"));
          },
        },
      };
    },
  }, { vscode });

  assert.equal(await provider({ spec: "/workspace/specs/example.spec" }), undefined);
  assert.equal(requestCalls, 0);
  assert.deepEqual(sources.map((source) => ({
    cancelCalls: source.cancelCalls,
    disposeCalls: source.disposeCalls,
  })), [{ cancelCalls: 1, disposeCalls: 1 }]);
});
