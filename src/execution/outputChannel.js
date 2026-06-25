"use strict";

const nodePath = require("node:path");

class LineBuffer {
  constructor(onLine) {
    this.pending = "";
    this.onLine = onLine;
  }

  append(chunk) {
    const parts = `${this.pending}${chunk}`.split(/\r?\n/);
    this.pending = parts.pop();
    for (const line of parts) {
      this.onLine(line);
    }
  }

  done() {
    if (this.pending) {
      this.onLine(this.pending);
      this.pending = "";
    }
  }
}

class OutputChannel {
  constructor(outputChannel, initial, projectRoot, options = {}) {
    this.channel = outputChannel;
    this.projectRoot = projectRoot;
    this.pathModule = options.pathModule || nodePath;
    this.outBuffer = new LineBuffer((line) => this.channel.appendLine(line));
    this.errBuffer = new LineBuffer((line) => this.channel.appendLine(line));

    this.channel.clear();
    this.channel.appendLine(initial);
    if (typeof this.channel.show === "function") {
      this.channel.show(true);
    }
  }

  absolutizeOutputPaths(line) {
    const markers = [/Specification: /, /at Object\.<anonymous>\s*\(/];
    const lines = line.split("\n");

    for (let index = 0; index < lines.length; index += 1) {
      for (const marker of markers) {
        const match = lines[index].match(marker);
        if (match && !lines[index].includes(this.projectRoot)) {
          lines[index] = lines[index].replace(
            match[0],
            `${match[0]}${this.projectRoot}${this.pathModule.sep}`,
          );
        }
      }
    }

    return lines.join("\n");
  }

  appendOutBuf(line) {
    this.outBuffer.append(this.absolutizeOutputPaths(line));
  }

  appendErrBuf(line) {
    this.errBuffer.append(line);
  }

  onFinish(resolve, code, successMessage, failureMessage, aborted) {
    this.outBuffer.done();
    this.errBuffer.done();

    if (aborted) {
      this.channel.appendLine("Run stopped by user.");
      resolve(false);
      return;
    }

    if (code) {
      this.channel.appendLine(failureMessage);
    } else {
      this.channel.appendLine(successMessage);
    }
    resolve(code === 0);
  }
}

module.exports = {
  OutputChannel,
};
