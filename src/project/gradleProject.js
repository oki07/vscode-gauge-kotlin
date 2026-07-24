"use strict";

const { Command } = require("../cli");
const { BuildToolProject } = require("./buildToolProject");

const GRADLE_COMMAND = "gradle";
const GRADLE_CLASSPATH_ARGS = "-q classpath --rerun";
const GRADLE_WRAPPER_FILES = ["gradlew", "gradlew.bat", "gradlew.cmd"];

function systemGradleCommand() {
  if (process.platform === "win32") {
    return new Command(GRADLE_COMMAND, ".bat", true);
  }
  return new Command(GRADLE_COMMAND);
}

class GradleProject extends BuildToolProject {
  classpathFromOutput(output) {
    return output.toString()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join(this.classpathDelimiter);
  }

  getBuildCommand(cli) {
    if (this.hasGradleWrapper()) {
      return cli.gradleCommand();
    }
    return systemGradleCommand();
  }

  getExecutionCommand(cli) {
    return cli.gaugeCommand();
  }

  executionKind() {
    return "gauge";
  }

  hasGradleWrapper() {
    if (!this.fileSystem || typeof this.fileSystem.existsSync !== "function") {
      return false;
    }
    return GRADLE_WRAPPER_FILES.some((filename) => (
      this.fileSystem.existsSync(this.pathModule.join(this.root(), filename))
    ));
  }

  envs(cli) {
    return this.classpathEnv(this.getBuildCommand(cli), GRADLE_CLASSPATH_ARGS);
  }

  envsAsync(cli) {
    return this.classpathEnvAsync(this.getBuildCommand(cli), GRADLE_CLASSPATH_ARGS);
  }

  executionEnvs(cli) {
    return this.classpathEnv(
      this.getBuildCommand(cli),
      "-q testClasses classpath --rerun",
    );
  }

  executionBuildToolCommand(cli) {
    return this.getBuildCommand(cli);
  }

  executionBuildArgs() {
    return "-q testClasses";
  }

  executionClasspathArgs() {
    return GRADLE_CLASSPATH_ARGS;
  }
}

module.exports = {
  GradleProject,
};
