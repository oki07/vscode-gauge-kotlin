"use strict";

const { BuildToolProject } = require("./buildToolProject");

class GradleProject extends BuildToolProject {
  getExecutionCommand(cli) {
    return cli.gradleCommand();
  }

  envs(cli) {
    return this.classpathEnv(this.getExecutionCommand(cli), "-q clean classpath");
  }
}

module.exports = {
  GradleProject,
};
