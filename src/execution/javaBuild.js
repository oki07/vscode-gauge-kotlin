"use strict";

// redhat-developer/vscode-java exposes serverReady and java.project.build.
// In real Gauge 1.6.35 Maven projects, Java auto-build removes Kotlin classes
// after serverReady. Complete the Java build before the build tool restores
// the classes that Gauge loads. Scope the request to the selected project.
async function waitForJavaBuild(vscode, projectRoot, request) {
  const extension = vscode.extensions?.getExtension?.("redhat.java");
  if (!extension) {
    return;
  }
  const uri = vscode.Uri.file(projectRoot);
  if (vscode.workspace.getConfiguration("java", uri).get("autobuild.enabled") === false) {
    return;
  }
  const source = typeof vscode.CancellationTokenSource === "function"
    ? new vscode.CancellationTokenSource() : undefined;
  request.javaBuildCancellation = source;
  try {
    const api = await extension.activate();
    if (request.cancelRequested || api?.serverMode === "LightWeight") {
      return;
    }
    if (typeof api?.serverReady !== "function") {
      throw new Error("Java language support cannot report build readiness.");
    }
    await api.serverReady();
    if (request.cancelRequested) {
      return;
    }
    // Maven or Gradle determines compilation success; Java completion only
    // establishes ordering before that compilation.
    await vscode.commands.executeCommand("java.project.build", uri, false, source?.token);
  } catch (error) {
    if (!request.cancelRequested) {
      throw error;
    }
  } finally {
    request.javaBuildCancellation = undefined;
    source?.dispose();
  }
}

module.exports = { waitForJavaBuild };
