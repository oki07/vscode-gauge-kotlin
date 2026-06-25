"use strict";

class GaugeClients extends Map {
  get(fsPath) {
    for (const projectClient of this.values()) {
      if (projectClient.project.hasFile(fsPath)) {
        return projectClient;
      }
    }
    return undefined;
  }
}

module.exports = {
  GaugeClients,
};
