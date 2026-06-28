const assert = require("node:assert/strict");
const test = require("node:test");

test("GaugeClients returns the project client for a project root", () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeProject } = require("../src/project/gaugeProject");
  const project = new GaugeProject("/workspace/gauge", {
    Language: "kotlin",
    Plugins: [],
  });
  const client = { id: "client" };
  const clients = new GaugeClients();

  clients.set(project.root(), { project, client });

  assert.equal(clients.get("/workspace/gauge").project, project);
  assert.equal(clients.get("/workspace/gauge").client, client);
});

test("GaugeClients returns the project client for a file inside a project", () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeProject } = require("../src/project/gaugeProject");
  const project = new GaugeProject("/workspace/gauge", {
    Language: "kotlin",
    Plugins: [],
  });
  const clients = new GaugeClients();

  clients.set(project.root(), { project, client: { id: "client" } });

  assert.equal(clients.get("/workspace/gauge/specs/example.spec").project, project);
});

test("GaugeClients returns the nearest project client for nested projects", () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeProject } = require("../src/project/gaugeProject");
  const parentProject = new GaugeProject("/workspace/gauge", {
    Language: "kotlin",
    Plugins: [],
  });
  const childProject = new GaugeProject("/workspace/gauge/modules/api", {
    Language: "kotlin",
    Plugins: [],
  });
  const clients = new GaugeClients();

  clients.set(parentProject.root(), { project: parentProject, client: { id: "parent" } });
  clients.set(childProject.root(), { project: childProject, client: { id: "child" } });

  assert.equal(
    clients.get("/workspace/gauge/modules/api/specs/example.spec").project,
    childProject,
  );
});

test("GaugeClients returns undefined for files outside known projects", () => {
  const { GaugeClients } = require("../src/gaugeClients");
  const { GaugeProject } = require("../src/project/gaugeProject");
  const project = new GaugeProject("/workspace/gauge", {
    Language: "kotlin",
    Plugins: [],
  });
  const clients = new GaugeClients();

  clients.set(project.root(), { project, client: { id: "client" } });

  assert.equal(clients.get("/workspace/other/specs/example.spec"), undefined);
});
