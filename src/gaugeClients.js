"use strict";

class GaugeClients extends Map {
  get(fsPath) {
    let nearest;
    for (const projectClient of this.values()) {
      if (projectClient.project.hasFile(fsPath)) {
        if (!nearest || projectClient.project.root().length > nearest.project.root().length) {
          nearest = projectClient;
        }
      }
    }
    return nearest;
  }
}

module.exports = {
  GaugeClients,
};
