"use strict";

const { BuildToolProject } = require("./buildToolProject");

// A Maven project may ship only the Maven Wrapper, which is the whole point of
// the wrapper: no system-wide Maven required. GradleProject already prefers
// gradlew over a system gradle; asking the CLI for `mvn` unconditionally left
// such a project unable to resolve its classpath, so every step read as
// unimplemented.
const MAVEN_WRAPPER_FILES = ["mvnw", "mvnw.cmd", "mvnw.bat"];

class MavenProject extends BuildToolProject {
  mavenWrapperCommand() {
    if (!this.fileSystem || typeof this.fileSystem.existsSync !== "function") {
      return undefined;
    }
    const pathModule = this.pathModule;
    if (!pathModule || typeof pathModule.join !== "function") {
      return undefined;
    }
    for (const filename of MAVEN_WRAPPER_FILES) {
      try {
        if (this.fileSystem.existsSync(pathModule.join(this.root(), filename))) {
          const isWindowsScript = filename !== "mvnw";
          return {
            command: isWindowsScript ? filename : "./mvnw",
            shellMode: true,
          };
        }
      } catch (_error) {
        return undefined;
      }
    }
    return undefined;
  }

  buildCommand(cli) {
    return this.mavenWrapperCommand() || cli.mavenCommand();
  }

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
    return this.classpathEnv(this.buildCommand(cli), "-q gauge:classpath");
  }

  envsAsync(cli) {
    return this.classpathEnvAsync(this.buildCommand(cli), "-q gauge:classpath");
  }

  executionEnvs(cli) {
    return this.classpathEnv(
      this.buildCommand(cli),
      "-q test-compile gauge:classpath",
    );
  }

  executionBuildToolCommand(cli) {
    return this.buildCommand(cli);
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
