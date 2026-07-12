"use strict";

const nodePath = require("node:path");
const { LineBuffer } = require("./lineBuffer");

class OutputChannel {
  constructor(outputChannel, initial, projectRoot, options = {}) {
    this.channel = outputChannel;
    this.projectRoot = projectRoot;
    this.pathModule = options.pathModule || nodePath;
    this.outBuffer = new LineBuffer();
    this.errBuffer = new LineBuffer();

    this.channel.clear();
    this.channel.appendLine(initial);
    if (options.reveal === true && typeof this.channel.show === "function") {
      this.channel.show(true);
    }
    this.outBuffer.onLine((line) => this.channel.appendLine(line));
    this.outBuffer.onDone((last) => {
      if (last) {
        this.channel.appendLine(last);
      }
    });
    this.errBuffer.onLine((line) => this.channel.appendLine(line));
    this.errBuffer.onDone((last) => {
      if (last) {
        this.channel.appendLine(last);
      }
    });
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
