"use strict";

const { BuildToolProject } = require("./buildToolProject");

class MavenProject extends BuildToolProject {
  classpathFromOutput(output) {
    const lines = super.classpathFromOutput(output).split(/\r?\n/);
    return lines[lines.length - 1] || "";
  }

  getExecutionCommand(cli) {
    return cli.gaugeCommand();
  }

  executionKind() {
    return "gauge";
  }

  executionPreparationCacheable() {
    return true;
  }

  envs(cli) {
    return this.classpathEnv(cli.mavenCommand(), "-q gauge:classpath");
  }

  envsAsync(cli) {
    return this.classpathEnvAsync(cli.mavenCommand(), "-q gauge:classpath");
  }

  executionEnvs(cli) {
    return this.classpathEnv(
      cli.mavenCommand(),
      "-q test-compile gauge:classpath",
    );
  }

  executionBuildToolCommand(cli) {
    return cli.mavenCommand();
  }

  executionBuildArgs() {
    return "-q test-compile";
  }

  executionBuildTaskArgs() {
    return ["test-compile"];
  }

  executionClasspathArgs() {
    return "-q gauge:classpath";
  }
}

module.exports = {
  MavenProject,
};
