"use strict";

const { BuildToolProject } = require("./buildToolProject");

class MavenProject extends BuildToolProject {
  getExecutionCommand(cli) {
    return cli.mavenCommand();
  }

  envs(cli) {
    return this.classpathEnv(`${this.getExecutionCommand(cli).command} -q gauge:classpath`);
  }
}

module.exports = {
  MavenProject,
};
