"use strict";

const { Command } = require("../cli");
const { BuildToolProject } = require("./buildToolProject");

const GRADLE_COMMAND = "gradle";
const GRADLE_WRAPPER_FILES = ["gradlew", "gradlew.bat", "gradlew.cmd"];

function systemGradleCommand() {
  if (process.platform === "win32") {
    return new Command(GRADLE_COMMAND, ".bat", true);
  }
  return new Command(GRADLE_COMMAND);
}

class GradleProject extends BuildToolProject {
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
    return this.classpathEnv(this.getBuildCommand(cli), "-q clean classpath");
  }

  executionEnvs(cli) {
    return this.classpathEnv(
      this.getBuildCommand(cli),
      "-q testClasses classpath",
    );
  }
}

module.exports = {
  GradleProject,
};
