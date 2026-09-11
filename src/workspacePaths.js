"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { canonicalFilePath } = require("./gaugeExecutionIdentifier");

function workspacePathMappings(vscode, file, options = {}) {
  if (!file) return [];
  const fileSystem = options.fileSystem || nodeFs;
  const pathModule = options.pathModule || nodePath;
  const physicalPath = canonicalFilePath(file, fileSystem, pathModule);
  return ((vscode && vscode.workspace && vscode.workspace.workspaceFolders) || [])
    .filter((folder) => folder && folder.uri && folder.uri.fsPath)
    .map((folder) => ({
      folder,
      physicalFolder: canonicalFilePath(folder.uri.fsPath, fileSystem, pathModule),
    }))
    .sort((left, right) => right.physicalFolder.length - left.physicalFolder.length)
    .flatMap(({ folder, physicalFolder }) => {
      const relative = pathModule.relative(physicalFolder, physicalPath);
      if (relative === ".." || relative.startsWith(`..${pathModule.sep}`)
        || pathModule.isAbsolute(relative)) return [];
      return [{ folder, path: pathModule.join(folder.uri.fsPath, relative) }];
    });
}

// VS Code's getWorkspaceFolder matches URI paths. Gauge can return a physical
// path for a project opened through a directory alias, so retain the owning
// WorkspaceFolder when attaching a debugger or reading scoped launch options.
function workspaceFolderForPath(vscode, file, options = {}) {
  if (!file) return undefined;
  const workspace = vscode && vscode.workspace;
  if (workspace && typeof workspace.getWorkspaceFolder === "function") {
    const uri = vscode.Uri && typeof vscode.Uri.file === "function"
      ? vscode.Uri.file(file) : { fsPath: file, path: file };
    const folder = workspace.getWorkspaceFolder(uri);
    if (folder) return folder;
  }
  return workspacePathMappings(vscode, file, options)[0]?.folder;
}

module.exports = { workspaceFolderForPath, workspacePathMappings };
