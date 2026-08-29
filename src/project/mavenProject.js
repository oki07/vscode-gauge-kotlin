"use strict";

const { BuildToolProject } = require("./buildToolProject");

// A Maven project may ship only the Maven Wrapper, which is the whole point of
// the wrapper: no system-wide Maven required. GradleProject already prefers
// gradlew over a system gradle; asking the CLI for `mvn` unconditionally left
// such a project unable to resolve its classpath, so every step read as
// unimplemented.
// A wrapper install ships the POSIX script and the Windows launchers together,
// so searching one flat list in order always picked "mvnw" on Windows and every
// classpath resolution and pre-run build failed. CLI.getGradleCommand branches
// on the platform for the same reason.
const MAVEN_WRAPPER_FILES = ["mvnw"];
const WINDOWS_MAVEN_WRAPPER_FILES = ["mvnw.cmd", "mvnw.bat"];

class MavenProject extends BuildToolProject {
  mavenWrapperCommand() {
    if (!this.fileSystem || typeof this.fileSystem.existsSync !== "function") {
      return undefined;
    }
    const pathModule = this.pathModule;
    if (!pathModule || typeof pathModule.join !== "function") {
      return undefined;
    }
    const isWindows = this.platform === "win32";
    const candidates = isWindows
      ? [...WINDOWS_MAVEN_WRAPPER_FILES, ...MAVEN_WRAPPER_FILES]
      : [...MAVEN_WRAPPER_FILES, ...WINDOWS_MAVEN_WRAPPER_FILES];
    for (const filename of candidates) {
      try {
        if (this.fileSystem.existsSync(pathModule.join(this.root(), filename))) {
          return {
            command: filename === "mvnw" && !isWindows ? "./mvnw" : filename,
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
