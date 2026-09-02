"use strict";

// Gauge publishes no Kotlin project template. references/gauge/template/template.go
// `defaults()` seeds dotnet, java, java_gradle, java_maven, java_maven_selenium,
// js, js_simple, python, python_selenium, ruby, ruby_selenium and ts, and the
// list only grows through an explicit `gauge template <name> <url>`, which this
// extension never issues. `gauge init` therefore has nothing Kotlin to unpack,
// so this extension ships its own scaffolds and writes them directly.
//
// The files are embedded rather than shipped as assets so that the esbuild
// bundle in out/extension.js stays self-contained: there is no extension root to
// resolve at runtime and no VSIX packaging step that can silently drop them.
//
// A Kotlin Gauge project runs on the gauge-java runner, so its manifest language
// is "java", the same shape as test/fixtures/selected-scenario-lifecycle and the
// shape src/project/projectFactory.js already accepts through isJvmLanguage.

const PROJECT_NAME_PLACEHOLDER = /\{\{projectName\}\}/g;

// Pinned deliberately. The Gradle plugin registers the `classpath` task that
// src/project/gradleProject.js runs as `gradle -q classpath --rerun`, and the
// Maven plugin registers the `classpath` goal that src/project/mavenProject.js
// runs as `mvn -q gauge:classpath`. Both were verified against the published
// artifacts for the pinned versions.
const GAUGE_JAVA_VERSION = "1.0.3";
const GAUGE_GRADLE_PLUGIN_VERSION = "3.2.0";
const GAUGE_MAVEN_PLUGIN_VERSION = "2.0.0";
const KOTLIN_VERSION = "2.2.21";
// The floor the templates document and Maven compiles against, not a JDK the
// project selects. A Gradle Java toolchain matches an installed JDK by exact
// major version and a fresh project configures no toolchain download
// repository, so pinning one there fails on every machine whose JDK is newer.
const JVM_TARGET = "17";

const MANIFEST = `{
  "Language": "java",
  "Plugins": [
    "html-report"
  ]
}
`;

const DEFAULT_PROPERTIES = `# The directories Gauge reads specifications from, relative to this project.
gauge_specs_dir = specs

# The directory HTML reports are written to.
gauge_reports_dir = reports

# Overwrite the previous report instead of keeping a timestamped copy.
overwrite_reports = true

# Capture a screenshot when a step fails. This is Gauge's own default
# (references/gauge/env/env.go addEnvVar(ScreenshotOnFailure, "true")).
screenshot_on_failure = true

# The directory Gauge writes logs to.
logs_directory = logs
`;

const JAVA_PROPERTIES = `# Java home used by the Gauge Java runner. Empty means JAVA_HOME.
gauge_java_home =

# Additional libraries added to the runner classpath.
gauge_additional_libs =

# Extra JVM arguments for the runner.
gauge_jvm_args =

# When Gauge clears the data store: suite, spec or scenario.
gauge_clear_state_level = scenario
`;

const EXAMPLE_SPEC = `# Specification Heading

This is an executable specification file. This file follows markdown syntax.
Every heading in this file denotes a scenario. Every bulleted point denotes a
step.

To execute this specification, run the "Run Specification" code lens above the
heading, or use the Gauge Specs view.

## Vowel counts in single word

* Vowels in English language are "aeiou".
* The word "gauge" has "3" vowels.

## Vowel counts in multiple words

A table under a scenario heading runs the steps below it once per row. Lines
that are not a heading, a step or a table row are comments.

   |word  |count|
   |------|-----|
   |gauge |3    |
   |mingle|2    |
   |snap  |1    |

* Vowels in English language are "aeiou".
* The word <word> has <count> vowels.
`;

const STEP_IMPLEMENTATION = `package example

import com.thoughtworks.gauge.Step

class StepImplementation {
    private var vowels: String = ""

    @Step("Vowels in English language are <vowelString>.")
    fun setLanguageVowels(vowelString: String) {
        vowels = vowelString
    }

    @Step("The word <word> has <expectedCount> vowels.")
    fun verifyVowelsCountInWord(word: String, expectedCount: Int) {
        val actualCount = word.count { character -> vowels.contains(character) }
        check(actualCount == expectedCount) {
            "Expected $expectedCount vowels in \\"$word\\" but found $actualCount"
        }
    }
}
`;

// The extension writes .classpath and .project into non-Maven JVM projects
// (src/config/gaugeProjectConfig.js), so a fresh project should not offer to
// commit them.
const GRADLE_GITIGNORE = `.gauge/
logs/
reports/
gauge_bin/
build/
.gradle/
.classpath
.project
`;

const MAVEN_GITIGNORE = `.gauge/
logs/
reports/
gauge_bin/
target/
.classpath
.project
`;

const GRADLE_BUILD = `plugins {
    kotlin("jvm") version "${KOTLIN_VERSION}"
    id("org.gauge") version "${GAUGE_GRADLE_PLUGIN_VERSION}"
}

repositories {
    mavenCentral()
}

dependencies {
    testImplementation("com.thoughtworks.gauge:gauge-java:${GAUGE_JAVA_VERSION}")
}
`;

const GRADLE_SETTINGS = `rootProject.name = "{{projectName}}"
`;

const MAVEN_POM = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <groupId>com.example</groupId>
  <artifactId>{{projectName}}</artifactId>
  <version>1.0-SNAPSHOT</version>

  <properties>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <kotlin.version>${KOTLIN_VERSION}</kotlin.version>
    <maven.compiler.release>${JVM_TARGET}</maven.compiler.release>
  </properties>

  <dependencies>
    <dependency>
      <groupId>org.jetbrains.kotlin</groupId>
      <artifactId>kotlin-stdlib</artifactId>
      <version>\${kotlin.version}</version>
    </dependency>
    <dependency>
      <groupId>com.thoughtworks.gauge</groupId>
      <artifactId>gauge-java</artifactId>
      <version>${GAUGE_JAVA_VERSION}</version>
      <scope>test</scope>
    </dependency>
  </dependencies>

  <build>
    <testSourceDirectory>src/test/kotlin</testSourceDirectory>
    <plugins>
      <plugin>
        <groupId>org.jetbrains.kotlin</groupId>
        <artifactId>kotlin-maven-plugin</artifactId>
        <version>\${kotlin.version}</version>
        <executions>
          <execution>
            <id>test-compile</id>
            <phase>test-compile</phase>
            <goals>
              <goal>test-compile</goal>
            </goals>
          </execution>
        </executions>
      </plugin>
      <plugin>
        <groupId>com.thoughtworks.gauge.maven</groupId>
        <artifactId>gauge-maven-plugin</artifactId>
        <version>${GAUGE_MAVEN_PLUGIN_VERSION}</version>
        <executions>
          <execution>
            <goals>
              <goal>execute</goal>
            </goals>
          </execution>
        </executions>
      </plugin>
    </plugins>
  </build>
</project>
`;

// No gradle-wrapper.jar can be embedded in a JavaScript bundle, so a project
// created from the Gradle template needs a Gradle on PATH until the user adds the
// wrapper. Say so rather than letting the first run fail with a bare ENOENT.
const GRADLE_README = `# {{projectName}}

Gauge specifications with Kotlin step implementations.

## Requirements

- JDK ${JVM_TARGET} or newer.
- Gauge CLI on your PATH.
- Gradle on your PATH. To make the project self-contained instead, run
  \`gradle wrapper\` once and commit the generated \`gradlew\`,
  \`gradlew.bat\` and \`gradle/wrapper/\` files; the extension prefers the
  wrapper when it is present.

## Layout

- \`specs/\` holds the specifications. The directory is named by
  \`gauge_specs_dir\` in \`env/default/default.properties\`.
- \`src/test/kotlin/\` holds the step implementations.

## Running

Use the Test Explorer, the Run and Debug code lenses above each specification, or
\`gradle gauge -PspecsDir=specs\` from a terminal.

\`gauge run specs\` will NOT work here: the Gauge Java runner compiles only
\`*.java\` from \`src/test/java\` and puts only \`gauge_bin\` on the classpath, so it
cannot see Kotlin classes that Gradle compiled. The build tool is the terminal
entry point, exactly as the stock \`java_gradle\` template documents.
`;

const MAVEN_README = `# {{projectName}}

Gauge specifications with Kotlin step implementations.

## Requirements

- JDK ${JVM_TARGET} or newer.
- Gauge CLI on your PATH.
- Maven on your PATH, or the Maven Wrapper (\`mvnw\`) in this directory.

## Layout

- \`specs/\` holds the specifications. The directory is named by
  \`gauge_specs_dir\` in \`env/default/default.properties\`.
- \`src/test/kotlin/\` holds the step implementations.

## Running

Use the Test Explorer, the Run and Debug code lenses above each specification, or
\`mvn clean test\` from a terminal.

\`gauge run specs\` will NOT work here: the Gauge Java runner compiles only
\`*.java\` from \`src/test/java\` and puts only \`gauge_bin\` on the classpath, so it
cannot see Kotlin classes that Maven compiled. The build tool is the terminal
entry point, exactly as the stock \`java_maven\` template documents.
`;

const SHARED_FILES = [
  { path: ["manifest.json"], content: MANIFEST },
  { path: ["env", "default", "default.properties"], content: DEFAULT_PROPERTIES },
  { path: ["env", "default", "java.properties"], content: JAVA_PROPERTIES },
  { path: ["specs", "example.spec"], content: EXAMPLE_SPEC },
  { path: ["src", "test", "kotlin", "example", "StepImplementation.kt"], content: STEP_IMPLEMENTATION },
];

const BUNDLED_TEMPLATES = [
  {
    label: "kotlin_gradle",
    description: "Kotlin with Gradle",
    buildTool: "gradle",
    files: SHARED_FILES.concat([
      { path: ["build.gradle.kts"], content: GRADLE_BUILD },
      { path: ["settings.gradle.kts"], content: GRADLE_SETTINGS },
      { path: ["README.md"], content: GRADLE_README },
      { path: [".gitignore"], content: GRADLE_GITIGNORE },
    ]),
  },
  {
    label: "kotlin_maven",
    description: "Kotlin with Maven",
    buildTool: "maven",
    files: SHARED_FILES.concat([
      { path: ["pom.xml"], content: MAVEN_POM },
      { path: ["README.md"], content: MAVEN_README },
      { path: [".gitignore"], content: MAVEN_GITIGNORE },
    ]),
  },
];

function listBundledKotlinTemplates() {
  return BUNDLED_TEMPLATES.map((template) => ({
    label: template.label,
    description: template.description,
    value: template.buildTool,
    bundled: true,
  }));
}

function bundledTemplateFor(label) {
  return BUNDLED_TEMPLATES.find((template) => template.label === label);
}

function isBundledTemplate(template) {
  return Boolean(template && template.bundled && bundledTemplateFor(template.label));
}

function renderTemplateFile(content, projectName) {
  return content.replace(PROJECT_NAME_PLACEHOLDER, projectName);
}

// Gauge project names come from the folder the user just created, so they are
// already valid path segments. Guard the build-file substitution anyway: a
// quote or an angle bracket would break settings.gradle.kts or pom.xml.
function safeProjectName(projectName) {
  const normalized = String(projectName || "").replace(/[^A-Za-z0-9._-]/g, "-");
  return normalized || "gauge-tests";
}

function writeBundledKotlinTemplate(options) {
  const { fileSystem, pathModule, projectRoot, template } = options;
  const bundled = bundledTemplateFor(template && template.label);
  if (!bundled) {
    return false;
  }
  const projectName = safeProjectName(
    options.projectName || pathModule.basename(projectRoot),
  );
  for (const file of bundled.files) {
    const directories = file.path.slice(0, -1);
    if (directories.length > 0) {
      fileSystem.mkdirSync(pathModule.join(projectRoot, ...directories), { recursive: true });
    }
    fileSystem.writeFileSync(
      pathModule.join(projectRoot, ...file.path),
      renderTemplateFile(file.content, projectName),
      "utf8",
    );
  }
  return true;
}

module.exports = {
  isBundledTemplate,
  listBundledKotlinTemplates,
  writeBundledKotlinTemplate,
};
